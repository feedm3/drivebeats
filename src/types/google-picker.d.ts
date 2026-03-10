export {};

declare global {
  interface GooglePickerDocsView {
    setIncludeFolders: (value: boolean) => GooglePickerDocsView;
    setLabel: (label: string) => GooglePickerDocsView;
    setMimeTypes: (mimeTypes: string) => GooglePickerDocsView;
    setMode: (mode: number) => GooglePickerDocsView;
    setParent: (parentId: string) => GooglePickerDocsView;
    setSelectFolderEnabled: (value: boolean) => GooglePickerDocsView;
  }

  interface GooglePickerInstance {
    setVisible: (visible: boolean) => void;
  }

  interface GooglePickerBuilder {
    addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
    build: () => GooglePickerInstance;
    enableFeature: (feature: number) => GooglePickerBuilder;
    setAppId: (appId: string) => GooglePickerBuilder;
    setCallback: (
      callback: (data: {
        action: string;
        docs?: Array<{ id?: string }>;
      }) => void,
    ) => GooglePickerBuilder;
    setDeveloperKey: (developerKey: string) => GooglePickerBuilder;
    setOAuthToken: (token: string) => GooglePickerBuilder;
    setOrigin: (origin: string) => GooglePickerBuilder;
  }

  interface Window {
    gapi: {
      load: (
        api: string,
        options: {
          callback: () => void;
          onerror?: () => void;
        },
      ) => void;
    };
    google: {
      picker: {
        Action: {
          CANCEL: string;
          PICKED: string;
        };
        DocsViewMode: {
          LIST: number;
        };
        Feature: {
          MULTISELECT_ENABLED: number;
        };
        ViewId: {
          DOCS: string;
          FOLDERS: string;
        };
        DocsView: new (viewId: string) => GooglePickerDocsView;
        PickerBuilder: new () => GooglePickerBuilder;
      };
    };
  }
}
