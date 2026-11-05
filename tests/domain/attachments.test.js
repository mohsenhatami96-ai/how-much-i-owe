import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extOf,
  mimeOf,
  isImageAtt,
  attName,
  fmtBytes,
  fileBadge,
  looksImage,
  fitSize,
  PHOTO_MODES,
  IMAGE_EXT,
  LARGE_FILE,
  DISPLAYABLE,
  MIME_BY_EXT,
} from '../../domain/attachments.js';

describe('extOf', () => {
  it('returns lowercase extension without the dot', () => {
    assert.equal(extOf('receipt.PDF'), 'pdf');
    assert.equal(extOf('a.b.jpeg'), 'jpeg');
    assert.equal(extOf('noext'), '');
    assert.equal(extOf(''), '');
    assert.equal(extOf(null), '');
  });

  it('caps extension length at 8', () => {
    assert.equal(extOf('x.toolongext'), '');
    assert.equal(extOf('x.abcdefgh'), 'abcdefgh');
  });
});

describe('mimeOf', () => {
  it('prefers file.type when set', () => {
    assert.equal(mimeOf({ type: 'image/png', name: 'x.jpg' }), 'image/png');
  });

  it('falls back to extension map', () => {
    assert.equal(mimeOf({ type: '', name: 'invoice.pdf' }), 'application/pdf');
    assert.equal(mimeOf({ type: '', name: 'shot.HEIC' }), 'image/heic');
    assert.equal(mimeOf({ type: '', name: 'notes.txt' }), 'text/plain');
  });

  it('defaults to octet-stream', () => {
    assert.equal(mimeOf({ type: '', name: 'weird.xyz' }), 'application/octet-stream');
  });
});

describe('isImageAtt / attName', () => {
  it('treats missing kind and kind image as images', () => {
    assert.equal(isImageAtt({}), true);
    assert.equal(isImageAtt({ kind: 'image' }), true);
    assert.equal(isImageAtt({ kind: 'file' }), false);
  });

  it('default names by kind', () => {
    assert.equal(attName({ name: 'a.pdf' }), 'a.pdf');
    assert.equal(attName({ kind: 'image' }), 'photo.jpg');
    assert.equal(attName({ kind: 'file' }), 'file');
    assert.equal(attName({}), 'photo.jpg');
  });
});

describe('fmtBytes', () => {
  it('formats B/KB/MB and handles missing', () => {
    assert.equal(fmtBytes(0), '0 B');
    assert.equal(fmtBytes(512), '512 B');
    assert.equal(fmtBytes(1536), '1.5 KB');
    assert.equal(fmtBytes(2 * 1024 * 1024), '2.0 MB');
    assert.equal(fmtBytes(null), '?');
    assert.equal(fmtBytes(undefined), '?');
  });
});

describe('fileBadge', () => {
  it('classifies pdf/doc/xls/img/gen', () => {
    assert.deepEqual(fileBadge({ name: 'a.pdf', type: 'application/pdf' }), { ext: 'PDF', cls: 'pdf' });
    assert.equal(fileBadge({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).cls, 'doc');
    assert.equal(fileBadge({ name: 'a.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).cls, 'xls');
    assert.equal(fileBadge({ name: 'a.png', type: 'image/png' }).cls, 'img');
    assert.equal(fileBadge({ name: 'a.zip', type: 'application/zip' }).cls, 'gen');
  });

  it('uses type subtype or file when no name ext', () => {
    const b = fileBadge({ name: '', type: 'application/pdf' });
    assert.equal(b.ext, 'PDF');
    assert.equal(b.cls, 'pdf');
  });
});

describe('looksImage', () => {
  it('detects by mime or extension', () => {
    assert.equal(looksImage({ type: 'image/jpeg', name: 'x' }), true);
    assert.equal(looksImage({ type: '', name: 'shot.webp' }), true);
    assert.equal(looksImage({ type: '', name: 'doc.pdf' }), false);
  });
});

describe('fitSize', () => {
  it('never upscales; caps long side', () => {
    assert.deepEqual(fitSize(100, 50, 200), [100, 50]);
    assert.deepEqual(fitSize(4000, 2000, 2000), [2000, 1000]);
    assert.deepEqual(fitSize(1000, 4000, 2000), [500, 2000]);
  });
});

describe('constants', () => {
  it('PHOTO_MODES has high/balanced/original', () => {
    assert.ok(PHOTO_MODES.high.max === 2560);
    assert.ok(PHOTO_MODES.balanced.max === 2048);
    assert.ok(PHOTO_MODES.original.max === Infinity);
  });

  it('IMAGE_EXT / LARGE_FILE / DISPLAYABLE / MIME_BY_EXT present', () => {
    assert.ok(IMAGE_EXT.includes('heic'));
    assert.equal(LARGE_FILE, 30 * 1024 * 1024);
    assert.ok(DISPLAYABLE.includes('image/webp'));
    assert.equal(MIME_BY_EXT.pdf, 'application/pdf');
  });
});
