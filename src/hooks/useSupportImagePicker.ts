import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import type { SupportAttachmentInput } from '../types/support';

export function useSupportImagePicker() {
  const [attachment, setAttachment] = useState<SupportAttachmentInput | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      selectionLimit: 1,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAttachment({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType });
    }
  };

  return { attachment, pickImage, removeImage: () => setAttachment(null) };
}
