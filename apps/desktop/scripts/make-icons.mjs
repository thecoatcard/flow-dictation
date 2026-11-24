// Renders assets/icon.svg into the files the app and installer need. Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const svg = readFileSync('assets/icon.svg');
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

writeFileSync('assets/icon.png', await png(512)); // window/taskbar icon, mac + linux builds
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(png));
writeFileSync('assets/icon.ico', await pngToIco(frames)); // exe + installer icon
writeFileSync('assets/tray.ico', await pngToIco(frames.slice(0, 5))); // crisp at tray sizes (100-250% DPI)
writeFileSync('assets/tray.png', await png(32)); // non-Windows tray
process.stdout.write('icons written\n');
