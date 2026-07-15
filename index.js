#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const googleTTS = require('google-tts-api');

const MAX_CHUNK_CHARS = 180;
const TMP_ROOT = path.resolve(__dirname, 'tmp');
const TMP_TEXT_DIR = path.join(TMP_ROOT, 'text');
const TMP_AUDIO_DIR = path.join(TMP_ROOT, 'audio');
const CHUNK_TEXT_PATTERN = /^chunk_\d+\.txt$/;
const CHUNK_AUDIO_PATTERN = /^audio_\d+\.mp3$/;

async function readText(input) {
    if (/^https?:\/\//i.test(input)) {
        const response = await axios.get(input, { responseType: 'text' });
        return response.data;
    }

    const resolvedPath = path.resolve(input);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Input file not found: ${resolvedPath}`);
    }

    return fs.readFileSync(resolvedPath, 'utf8');
}

function getOutputPath(input, output) {
    if (output) {
        return path.resolve(output);
    }

    if (/^https?:\/\//i.test(input)) {
        return path.resolve('output.mp3');
    }

    const inputPath = path.parse(input);
    return path.resolve(`${inputPath.name || 'output'}.mp3`);
}

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDirectory(dirPath, pattern) {
    if (!fs.existsSync(dirPath)) {
        return;
    }

    for (const entry of fs.readdirSync(dirPath)) {
        if (pattern.test(entry)) {
            fs.unlinkSync(path.join(dirPath, entry));
        }
    }
}

function clearTmpFiles() {
    ensureDirectory(TMP_TEXT_DIR);
    ensureDirectory(TMP_AUDIO_DIR);
    cleanDirectory(TMP_TEXT_DIR, CHUNK_TEXT_PATTERN);
    cleanDirectory(TMP_AUDIO_DIR, CHUNK_AUDIO_PATTERN);

    const tempFiles = ['concat-list.txt'];
    for (const fileName of tempFiles) {
        const filePath = path.join(TMP_ROOT, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    console.log('Cleared temporary files from tmp/text and tmp/audio.');
}

function splitTextIntoChunks(text, maxChars = MAX_CHUNK_CHARS) {
    const normalizedText = text.replace(/\r\n/g, '\n').trim();
    if (!normalizedText) {
        return [];
    }

    if (normalizedText.length <= maxChars) {
        return [normalizedText];
    }

    const chunks = [];
    let currentChunk = '';
    const words = normalizedText.split(/\s+/).filter(Boolean);

    for (const word of words) {
        const candidate = currentChunk ? `${currentChunk} ${word}` : word;

        if (candidate.length <= maxChars) {
            currentChunk = candidate;
            continue;
        }

        if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = '';
        }

        if (word.length > maxChars) {
            let remaining = word;
            while (remaining.length > maxChars) {
                chunks.push(remaining.slice(0, maxChars));
                remaining = remaining.slice(maxChars);
            }
            currentChunk = remaining;
        } else {
            currentChunk = word;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

function writeChunkFiles(chunks) {
    ensureDirectory(TMP_TEXT_DIR);
    cleanDirectory(TMP_TEXT_DIR, CHUNK_TEXT_PATTERN);

    return chunks.map((chunk, index) => {
        const chunkPath = path.join(TMP_TEXT_DIR, `chunk_${index + 1}.txt`);
        fs.writeFileSync(chunkPath, chunk, 'utf8');
        return chunkPath;
    });
}

function generateLocalAudio(text, outputPath) {
    const tempAiffPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, '.mp3')}.aiff`);

    try {
        execFileSync('say', ['-v', 'Samantha', text, '-o', tempAiffPath]);
        execFileSync('ffmpeg', ['-y', '-i', tempAiffPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputPath]);
        fs.unlinkSync(tempAiffPath);
    } catch (error) {
        if (fs.existsSync(tempAiffPath)) {
            fs.unlinkSync(tempAiffPath);
        }
        throw error;
    }
}

async function generateAudio(text, outputPath) {
    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'en',
            slow: false,
            host: 'https://translate.google.com',
        });

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
        });

        fs.writeFileSync(outputPath, Buffer.from(response.data));
        return 'google';
    } catch (error) {
        generateLocalAudio(text, outputPath);
        return 'local';
    }
}

function mergeAudioFiles(chunkAudioPaths, outputPath) {
    if (chunkAudioPaths.length === 1) {
        fs.copyFileSync(chunkAudioPaths[0], outputPath);
        return;
    }

    const listPath = path.join(TMP_ROOT, 'concat-list.txt');
    const listContent = chunkAudioPaths
        .map((audioPath) => `file '${audioPath.replace(/'/g, "'\\''")}'`)
        .join('\n');

    fs.writeFileSync(listPath, listContent, 'utf8');

    try {
        execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
    } catch (error) {
        const inputs = chunkAudioPaths.flatMap((audioPath) => ['-i', audioPath]);
        execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', `concat=n=${chunkAudioPaths.length}:v=0:a=1`, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputPath]);
    }
}

async function generateChunkedAudio(text, outputPath) {
    const chunks = splitTextIntoChunks(text);
    const chunkFiles = writeChunkFiles(chunks);

    ensureDirectory(TMP_AUDIO_DIR);
    cleanDirectory(TMP_AUDIO_DIR, CHUNK_AUDIO_PATTERN);

    const chunkAudioPaths = [];
    for (const [index, chunkFile] of chunkFiles.entries()) {
        const chunkText = fs.readFileSync(chunkFile, 'utf8');
        const chunkAudioPath = path.join(TMP_AUDIO_DIR, `audio_${index + 1}.mp3`);
        const mode = await generateAudio(chunkText, chunkAudioPath);
        chunkAudioPaths.push(chunkAudioPath);
        console.log(`Rendered chunk ${index + 1}/${chunkFiles.length} using ${mode} synthesis.`);
    }

    mergeAudioFiles(chunkAudioPaths, outputPath);
    return chunkFiles.length;
}

async function main() {
    const [, , command, target, output] = process.argv;

    if (command === 'clear-tmp') {
        clearTmpFiles();
        return;
    }

    const filename = command;
    const outputPath = output;

    if (!filename) {
        console.error('Usage: node index.js <filename-or-url> [output.mp3]');
        process.exit(1);
    }

    try {
        const text = (await readText(filename)).trim();
        if (!text) {
            throw new Error('The input text is empty.');
        }

        const resolvedOutputPath = getOutputPath(filename, outputPath);
        const normalizedText = text.replace(/\s+/g, ' ').trim();
        const shouldChunk = normalizedText.length > MAX_CHUNK_CHARS;

        if (shouldChunk) {
            console.log(`Detected a long input (${normalizedText.length} characters). Splitting it into chunks under tmp/text and tmp/audio.`);
            const chunkCount = await generateChunkedAudio(normalizedText, resolvedOutputPath);
            console.log(`Success! Your audio file is saved as ${resolvedOutputPath} from ${chunkCount} chunks.`);
            return;
        }

        const mode = await generateAudio(normalizedText, resolvedOutputPath);
        console.log(`Success! Your audio file is saved as ${resolvedOutputPath} using ${mode} synthesis.`);
    } catch (error) {
        console.error('Error generating audio:', error.message);
        process.exit(1);
    }
}

main();
