const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\Ranjith Thangapalam\\.gemini\\antigravity\\brain\\33a8974f-6393-4406-8f15-51caf39e59bf';

function getPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  // PNG signature check
  if (buffer.readUInt32BE(0) !== 0x89504E47) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function getJpgDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  let i = 0;
  if (buffer.readUInt16BE(0) !== 0xFFD8) {
    return null;
  }
  i += 2;
  while (i < buffer.length) {
    const marker = buffer.readUInt16BE(i);
    i += 2;
    if (marker >= 0xFFC0 && marker <= 0xFFC3) {
      // SOF marker
      const length = buffer.readUInt16BE(i);
      const height = buffer.readUInt16BE(i + 3);
      const width = buffer.readUInt16BE(i + 5);
      return { width, height };
    } else {
      const length = buffer.readUInt16BE(i);
      i += length;
    }
  }
  return null;
}

const files = fs.readdirSync(dir);
console.log('Files in directory:');
files.forEach(f => {
  if (f.startsWith('media__17812048639')) {
    const fullPath = path.join(dir, f);
    let dims = null;
    if (f.endsWith('.png')) {
      dims = getPngDimensions(fullPath);
    } else if (f.endsWith('.jpg') || f.endsWith('.jpeg')) {
      dims = getJpgDimensions(fullPath);
    }
    console.log(`${f}: size=${fs.statSync(fullPath).size} bytes, dims=${JSON.stringify(dims)}`);
  }
});
