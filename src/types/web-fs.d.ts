export {};

declare global {
  interface FileSystemPermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemPermissionDescriptor
    ): Promise<PermissionState>;
    requestPermission(
      descriptor?: FileSystemPermissionDescriptor
    ): Promise<PermissionState>;
    isSameEntry?(other: FileSystemHandle): Promise<boolean>;
  }

  interface FileSystemFileHandle {
    move?(
      destinationDirectory: FileSystemDirectoryHandle,
      newName?: string
    ): Promise<void>;
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    removeEntry(name: string, options?: {recursive?: boolean}): Promise<void>;
  }

  interface DirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }

  interface Window {
    showDirectoryPicker(
      options?: DirectoryPickerOptions
    ): Promise<FileSystemDirectoryHandle>;
  }
}
