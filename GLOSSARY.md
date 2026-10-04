# DriveBeats

DriveBeats is a music library and player for audio a user deliberately selects from Google Drive.

## Language

**Playable Track**:
A supported audio file that DriveBeats can play.
_Avoid_: File, song

**Imported Folder**:
A Google Drive folder the user deliberately includes in DriveBeats; its descendant Playable Tracks belong to the user's music library.
_Avoid_: Selected folder, synced folder

**Current Folder**:
The Imported Folder or descendant folder currently shown in the file browser.
_Avoid_: Active folder, open folder

**Standalone Track**:
A Playable Track the user imports individually rather than through an Imported Folder.
_Avoid_: Loose file, root file

**Library**:
The user's DriveBeats music collection, consisting of Standalone Tracks and the Playable Tracks within every Imported Folder.
_Avoid_: Google Drive, My Drive, global files

**Library Search**:
An online, filename-only search across every Playable Track in the Library.
_Avoid_: Global Search, Drive search

**Current Folder Search**:
A filename-only search limited to the Current Folder.
_Avoid_: Local search
