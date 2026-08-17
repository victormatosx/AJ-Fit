import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SCREEN = readFileSync('src/screens/EditProfileScreen.tsx', 'utf8');
const SERVICE = readFileSync('src/services/profilePhoto.ts', 'utf8');
const BLOB_ADAPTER = readFileSync('src/services/profilePhotoUploadBlob.ts', 'utf8');
const PROFILE_UPLOAD_CODE = `${SERVICE}\n${BLOB_ADAPTER}`
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('profile photo edit lifecycle', () => {
  it('treats picker cancellation as no selection and starts no upload', () => {
    const selectedAsset = SCREEN.slice(
      SCREEN.indexOf('function selectedAsset'),
      SCREEN.indexOf('export function EditProfileScreen'),
    );
    expect(selectedAsset).toContain('if (result.canceled || !result.assets[0]) return null');
    const accept = SCREEN.slice(
      SCREEN.indexOf('async function acceptPhoto'),
      SCREEN.indexOf('async function chooseFromLibrary'),
    );
    expect(accept).toContain('if (!photo) return');
    expect(accept).not.toContain('uploadProfilePhoto');
  });

  it('routes original and zoom/crop picker output through one local-URI contract', () => {
    expect(SCREEN).toContain('uri: asset.uri');
    expect(SCREEN).toContain('compressProfilePhoto(photo)');
    expect(SERVICE).toContain('openProfilePhotoUploadBlob(photo.uri)');
    expect(SERVICE).toContain('uploadBytesResumable(target, blob');
  });

  it('never converts profile pixels to ArrayBufferView or base64', () => {
    for (const prohibited of ['.bytes()', 'Uint8Array', 'arrayBuffer()', 'base64', 'new Blob(']) {
      expect(PROFILE_UPLOAD_CODE).not.toContain(prohibited);
    }
  });

  it('retains the edited temp on upload failure but releases replaced, removed, saved and unmounted temps', () => {
    expect(SCREEN).toContain('const replacePendingPhoto = useCallback');
    expect(SCREEN).toContain('discardProfilePhotoTemporary(photo)');
    expect(SCREEN).toContain('discardProfilePhotoTemporary(previous)');
    expect(SCREEN).toContain('replacePendingPhoto(null)');
    expect(SCREEN).toContain('discardProfilePhotoTemporary(savedTemporary)');
    expect(SCREEN).toContain('discardProfilePhotoTemporary(owned)');

    const upload = SCREEN.slice(
      SCREEN.indexOf('async function handleSave'),
      SCREEN.indexOf('const changeDatePart'),
    );
    const catchBlock = upload.slice(upload.indexOf('} catch (err)'));
    expect(catchBlock).not.toContain('discardProfilePhotoTemporary');
  });

  it('handles picker, compression and upload/update rejections', () => {
    expect(SCREEN).toContain("logError('profile:compress-photo', err)");
    expect(SCREEN).toContain("logError('profile:pick-photo', err)");
    expect(SCREEN).toContain("logError('profile:update', err)");
    expect(SERVICE).toContain("throw new Error('profile-photo-upload-failed')");
  });
});
