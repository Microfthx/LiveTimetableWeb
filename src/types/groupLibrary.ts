/** Website-level group identity. It does not change OCR EventData v1.0. */
export interface GroupLibraryRecord {
  id: string;
  name: string;
  aliases?: string[];
  weiboUid?: string;
  weiboUrl?: string;
  avatarUrl?: string;
  avatarSourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  boundActivityCount?: number;
}

export type GroupBindings = Record<string, string>;

export interface WeiboGroupPreview {
  name: string;
  weiboUid: string;
  weiboUrl: string;
  avatarSourceUrl?: string;
  avatarDataUrl?: string;
}
