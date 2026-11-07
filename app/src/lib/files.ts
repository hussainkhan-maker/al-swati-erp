import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

/** Camera or gallery, then shrink to ~1600px so uploads stay fast on site networks. */
export async function pickPhoto(fromCamera: boolean): Promise<string | null> {
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ["images"] })
    : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ["images"] });
  if (res.canceled || !res.assets?.[0]) return null;
  const small = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 1600 } }], {
    compress: 0.6, format: ImageManipulator.SaveFormat.JPEG,
  });
  return small.uri;
}

export async function uploadFile(bucket: "receipts" | "documents", path: string, uri: string, contentType = "image/jpeg") {
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, buf, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

const urlCache: Record<string, { url: string; until: number }> = {};
export async function signedUrl(bucket: string, path: string) {
  const k = bucket + "/" + path, c = urlCache[k];
  if (c && c.until > Date.now()) return c.url;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (data?.signedUrl) urlCache[k] = { url: data.signedUrl, until: Date.now() + 50 * 60e3 };
  return data?.signedUrl ?? null;
}
