#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const googleTTS = require('google-tts-api');

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

    const inputPath = path.parse(input);
    return path.resolve(`${inputPath.name || 'output'}.mp3`);
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

async function main() {
    const filename = process.argv[2];
    const output = process.argv[3];

    if (!filename) {
        console.error('Usage: node index.js <filename-or-path> [output.mp3]');
        process.exit(1);
    }

    try {
        const text = (await readText(filename)).trim();
        if (!text) {
            throw new Error('The input text is empty.');
        }

        const outputPath = getOutputPath(filename, output);
        const mode = await generateAudio(text, outputPath);

        console.log(`Success! Your audio file is saved as ${outputPath} using ${mode} synthesis.`);
    } catch (error) {
        console.error('Error generating audio:', error.message);
        process.exit(1);
    }
}

main();
