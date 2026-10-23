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
A search across every Playable Track in the Library using filenames and current audio title, artist, and album tags cached on this device, including tags restored from the user's Google Drive backup.
_Avoid_: Global Search, Drive search

**Current Folder Search**:
A search limited to the Current Folder using filenames and current audio title, artist, and album tags cached on this device, including restored tags.
_Avoid_: Local search

**Playlist**:
A named, saved collection of Playable Tracks in a user-chosen order.
_Avoid_: Playback Queue

**Playback Queue**:
The sequence of Playable Tracks selected for the current listening activity.
_Avoid_: Playlist when referring only to what will play next

**DJ Mode**:
An optional listening mode in which AI selects upcoming Playable Tracks from the user's Library.
_Avoid_: Shuffle when referring to AI selection
