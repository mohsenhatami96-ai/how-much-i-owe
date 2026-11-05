import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bufToB64,
  b64ToBuf,
  dataUrlToBuf,
  settingsFromMeta,
  encodeAttachmentForExport,
  buildExportPayload,
  backupFilename,
  serializeBackup,
  parseBackupText,
  normalizeImport,
} from '../../domain/backup.js';

function bytes(...arr) {
  return new Uint8Array(arr).buffer;
}

describe('bufToB64 / b64ToBuf', () => {
  it('round-trips binary bytes', () => {
    const buf = bytes(0, 1, 2, 255, 128, 7);
    const b64 = bufToB64(buf);
    assert.equal(typeof b64, 'string');
    assert.ok(b64.length > 0);
    assert.deepEqual([...new Uint8Array(b64ToBuf(b64))], [0, 1, 2, 255, 128, 7]);
  });

  it('handles empty buffer', () => {
    assert.equal(bufToB64(bytes()), '');
    assert.equal(b64ToBuf('').byteLength, 0);
  });
});

describe('dataUrlToBuf', () => {
  it('strips data URL prefix', () => {
    const raw = bytes(10, 20, 30);
    const b64 = bufToB64(raw);
    const got = dataUrlToBuf(`data:image/jpeg;base64,${b64}`);
    assert.deepEqual([...new Uint8Array(got)], [10, 20, 30]);
  });

  it('accepts bare base64', () => {
    const b64 = bufToB64(bytes(1, 2));
    assert.deepEqual([...new Uint8Array(dataUrlToBuf(b64))], [1, 2]);
  });

  it('returns null for non-string', () => {
    assert.equal(dataUrlToBuf(null), null);
    assert.equal(dataUrlToBuf(42), null);
  });
});

describe('settingsFromMeta', () => {
  it('excludes lastBackup and maps key/value', () => {
    const settings = settingsFromMeta([
      { key: 'defaultCurrency', value: 'EUR' },
      { key: 'lastBackup', value: 123 },
      { key: 'photoQuality', value: 'balanced' },
    ]);
    assert.deepEqual(settings, { defaultCurrency: 'EUR', photoQuality: 'balanced' });
  });
});

describe('encodeAttachmentForExport', () => {
  it('encodes image with thumb as data URLs', () => {
    const full = bytes(1, 2, 3, 4);
    const thumb = bytes(9, 9);
    const enc = encodeAttachmentForExport(
      { id: 'a1', personId: 'p1', entryId: 'e1', kind: 'image', type: 'image/jpeg', name: 'photo.jpg' },
      full,
      thumb,
    );
    assert.equal(enc.kind, 'image');
    assert.equal(enc.type, 'image/jpeg');
    assert.equal(enc.name, 'photo.jpg');
    assert.equal(enc.size, 4);
    assert.ok(enc.data.startsWith('data:image/jpeg;base64,'));
    assert.ok(enc.thumb.startsWith('data:image/jpeg;base64,'));
    assert.deepEqual([...new Uint8Array(dataUrlToBuf(enc.data))], [1, 2, 3, 4]);
  });

  it('encodes file attachments without thumb', () => {
    const full = bytes(65, 66, 67); // ABC
    const enc = encodeAttachmentForExport(
      { id: 'f1', personId: 'p1', entryId: null, kind: 'file', type: 'application/pdf', name: 'invoice.pdf' },
      full,
      null,
    );
    assert.equal(enc.kind, 'file');
    assert.equal(enc.type, 'application/pdf');
    assert.equal(enc.name, 'invoice.pdf');
    assert.equal(enc.size, 3);
    assert.ok(enc.data.startsWith('data:application/pdf;base64,'));
    assert.equal(enc.thumb, undefined);
  });

  it('infers kind/type/name when missing (image default)', () => {
    const enc = encodeAttachmentForExport({ id: 'x', personId: 'p' }, bytes(1), null);
    assert.equal(enc.kind, 'image');
    assert.equal(enc.type, 'image/jpeg');
    assert.equal(enc.name, 'photo.jpg');
  });
});

describe('buildExportPayload + serializeBackup', () => {
  it('builds format 2 payload with settings and counts', () => {
    const people = [{ id: 'p1', name: 'Ada' }];
    const entries = [{ id: 'e1', personId: 'p1', type: 'borrow', amount: 100, currency: 'SEK' }];
    const encodedImages = [
      encodeAttachmentForExport(
        { id: 'a1', personId: 'p1', entryId: 'e1', kind: 'image', type: 'image/jpeg', name: 'r.jpg' },
        bytes(1, 2),
        bytes(3),
      ),
    ];
    const meta = [
      { key: 'defaultCurrency', value: 'SEK' },
      { key: 'lastBackup', value: 999 },
    ];
    const exportedAt = '2026-01-02T03:04:05.000Z';
    const payload = buildExportPayload({
      people, entries, encodedImages, meta, appVersion: '1.2.0', exportedAt,
    });
    assert.equal(payload.app, 'how-much-i-owe');
    assert.equal(payload.format, 2);
    assert.equal(payload.appVersion, '1.2.0');
    assert.equal(payload.exportedAt, exportedAt);
    assert.deepEqual(payload.settings, { defaultCurrency: 'SEK' });
    assert.equal(payload.people.length, 1);
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.images.length, 1);
    assert.equal(payload.images[0].kind, 'image');

    const { json, filename, counts } = serializeBackup(payload, new Date('2026-01-02T03:04:00.000Z'));
    assert.equal(counts.people, 1);
    assert.equal(counts.entries, 1);
    assert.equal(counts.images, 1);
    assert.equal(filename, 'how-much-i-owe-backup-2026-01-02-03-04.json');
    assert.equal(JSON.parse(json).format, 2);
  });
});

describe('backupFilename', () => {
  it('uses ISO stamp without colons', () => {
    assert.equal(backupFilename(new Date('2026-11-05T12:34:56.000Z')), 'how-much-i-owe-backup-2026-11-05-12-34.json');
  });
});

describe('parseBackupText', () => {
  it('rejects invalid JSON', () => {
    assert.throws(() => parseBackupText('{nope'), /not valid JSON/i);
  });

  it('rejects wrong app', () => {
    assert.throws(() => parseBackupText(JSON.stringify({ app: 'other', people: [] })), /does not look like/i);
  });

  it('rejects missing people array', () => {
    assert.throws(() => parseBackupText(JSON.stringify({ app: 'how-much-i-owe' })), /does not look like/i);
  });

  it('accepts a minimal valid backup', () => {
    const data = parseBackupText(JSON.stringify({ app: 'how-much-i-owe', people: [] }));
    assert.equal(data.app, 'how-much-i-owe');
  });
});

describe('normalizeImport format 2 round-trip', () => {
  it('round-trips people, entries, image and file', () => {
    const people = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bob' }];
    const entries = [
      { id: 'e1', personId: 'p1', type: 'borrow', amount: 15050, currency: 'sek', note: 'x' },
      { id: 'e2', personId: 'p2', type: 'repay', amount: 100, currency: 'EUR' },
      { id: 'e-orphan', personId: 'missing', type: 'borrow', amount: 1, currency: 'SEK' },
    ];
    const imgBuf = bytes(11, 22, 33);
    const thumbBuf = bytes(44);
    const pdfBuf = bytes(37, 80, 68, 70); // %PDF-ish
    const encodedImages = [
      encodeAttachmentForExport(
        { id: 'img1', personId: 'p1', entryId: 'e1', kind: 'image', type: 'image/jpeg', name: 'r.jpg', origSize: 999 },
        imgBuf,
        thumbBuf,
      ),
      encodeAttachmentForExport(
        { id: 'file1', personId: 'p1', entryId: 'e1', kind: 'file', type: 'application/pdf', name: 'invoice.pdf' },
        pdfBuf,
        null,
      ),
      // orphan person filtered
      encodeAttachmentForExport(
        { id: 'bad', personId: 'ghost', entryId: null, kind: 'image' },
        bytes(1),
        null,
      ),
    ];
    const payload = buildExportPayload({
      people, entries, encodedImages,
      meta: [{ key: 'defaultCurrency', value: 'EUR' }, { key: 'photoQuality', value: 'high' }],
      appVersion: '1.2.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
    });
    const { json } = serializeBackup(payload);
    const data = parseBackupText(json);
    const norm = normalizeImport(data);

    assert.equal(norm.people.length, 2);
    assert.equal(norm.entries.length, 2); // orphan person entry dropped
    assert.equal(norm.entries.find((e) => e.id === 'e1').amount, 15050);
    assert.equal(norm.entries.find((e) => e.id === 'e1').currency, 'SEK');
    assert.equal(norm.entries.find((e) => e.id === 'e1').type, 'borrow');
    assert.equal(norm.entries.find((e) => e.id === 'e2').type, 'repay');
    assert.equal(norm.images.length, 2);

    const img = norm.images.find((i) => i.id === 'img1');
    assert.equal(img.kind, 'image');
    assert.equal(img.entryId, 'e1');
    assert.ok(img.data instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(img.data)], [11, 22, 33]);
    assert.ok(img.thumb instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(img.thumb)], [44]);
    assert.equal(img.type, 'image/jpeg');
    assert.equal(img.name, 'r.jpg');

    const file = norm.images.find((i) => i.id === 'file1');
    assert.equal(file.kind, 'file');
    assert.ok(file.data instanceof Blob);
    assert.equal(file.data.type, 'application/pdf');
    assert.equal(file.size, 4);
    assert.equal(file.name, 'invoice.pdf');
    assert.equal(file.thumb, undefined); // stripped for files

    assert.deepEqual(norm.settings, { defaultCurrency: 'EUR', photoQuality: 'high' });
  });

  it('drops entryId that is not in imported entries', () => {
    const people = [{ id: 'p1', name: 'Ada' }];
    const entries = [{ id: 'e1', personId: 'p1', type: 'borrow', amount: 1, currency: 'SEK' }];
    const enc = encodeAttachmentForExport(
      { id: 'img1', personId: 'p1', entryId: 'gone', kind: 'image', type: 'image/jpeg', name: 'x.jpg' },
      bytes(1),
      null,
    );
    const payload = buildExportPayload({
      people, entries, encodedImages: [enc], meta: [], appVersion: '1.2.0', exportedAt: '2026-01-01T00:00:00.000Z',
    });
    const norm = normalizeImport(parseBackupText(serializeBackup(payload).json));
    assert.equal(norm.images[0].entryId, null);
  });
});

describe('normalizeImport format 1 compatibility', () => {
  it('treats attachments without kind as images', () => {
    const imgB64 = bufToB64(bytes(7, 8, 9));
    const thumbB64 = bufToB64(bytes(1));
    const data = {
      app: 'how-much-i-owe',
      format: 1,
      appVersion: '1.0.0',
      people: [{ id: 'p1', name: 'Ada' }],
      entries: [{ id: 'e1', personId: 'p1', type: 'borrow', amount: 50, currency: 'SEK' }],
      images: [{
        id: 'img1', personId: 'p1', entryId: 'e1',
        // no kind, no size — format 1 shape
        data: `data:image/jpeg;base64,${imgB64}`,
        thumb: `data:image/jpeg;base64,${thumbB64}`,
      }],
      settings: { defaultCurrency: 'SEK' },
    };
    const norm = normalizeImport(data);
    assert.equal(norm.images.length, 1);
    const im = norm.images[0];
    assert.equal(im.kind, 'image');
    assert.ok(im.data instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(im.data)], [7, 8, 9]);
    assert.ok(im.thumb instanceof ArrayBuffer);
    assert.equal(im.type, 'image/jpeg');
    assert.equal(im.name, 'photo.jpg');
    assert.equal(im.size, 3);
  });

  it('uses full buffer as thumb when thumb missing', () => {
    const imgB64 = bufToB64(bytes(5, 6));
    const data = {
      app: 'how-much-i-owe',
      people: [{ id: 'p1', name: 'A' }],
      entries: [],
      images: [{ id: 'i', personId: 'p1', data: `data:image/jpeg;base64,${imgB64}` }],
    };
    const im = normalizeImport(data).images[0];
    assert.deepEqual([...new Uint8Array(im.thumb)], [5, 6]);
  });
});
