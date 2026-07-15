# Text to Speech

A small Node.js CLI that turns a text file, Markdown file, or URL into an MP3 audio file.

## Features

- Reads text from a local file or remote URL
- Supports both .txt and .md input files
- Uses Google Text-to-Speech first for natural audio
- Falls back to the local macOS speech engine when needed
- Splits very long input into chunks, renders each chunk separately, and merges them into one MP3

## Installation

```bash
npm install
```

## Usage

```bash
npm run to-speech <path-or-url> [output.mp3]
```

Examples:

```bash
npm run to-speech sample.txt
npm run to-speech notes.md output.mp3
npm run to-speech https://example.com/article
```

## Output behavior

- If the input is short, the app generates a single MP3 directly.
- If the input is long, it writes intermediate chunk files to tmp/text and audio chunks to tmp/audio before combining them into the final MP3.

## Notes

- The Google TTS path is limited to shorter requests, so long inputs are automatically split into smaller chunks.
- The local fallback uses the `say` command and `ffmpeg`, which are available on macOS.
