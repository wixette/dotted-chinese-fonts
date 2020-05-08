#!/usr/bin/env node --max-old-space-size=8192


const { PcfParser } = require('./pcf-parser');
const opentype = require('opentype.js');
const yargs = require('yargs');


const argv = yargs
      .usage('Usage: $0 [options]')

      .alias('i', 'input')
      .describe('i', 'The bitmap font file to be converted, in PCF format.')

      .alias('o', 'output')
      .describe('o', 'The output OpenType font file, in OTF format.')

      .alias('p', 'glyph_size_in_pixel')
      .describe('p',
                'The max glyph size in pixel. E.g., 10pt Chinese bitmap font ' +
                'usually uses 13 as the pixel size, 15 for 11pt, 16 for 12pt. ' +
                'etc. This value could be found in the properties table of ' +
                'the PCF file.')
      .default('p', 13)

      .alias('s', 'dot_shape')
      .choices('s', ['square', 'circle', 'diamond'])
      .describe('s', 'The shape of dots.')
      .default('s', 'square')

      .alias('t', 'font_style')
      .describe('t', 'The style of the generated font.')
      .default('t', 'Regular')

      .alias('f', 'family_name')
      .describe('f', 'The family name of the generated font.')

      .alias('r', 'font_version')
      .describe('r', 'The version of the generated font.')
      .default('r', '0.1')

      .alias('e', 'font_designer')
      .describe('e', 'The designer of the generated font.')
      .default('e', 'wixette')

      .alias('c', 'font_copyright')
      .describe('c', 'The copyright of the generated font.')
      .default('c', 'Copyright (C) 2020 wixette')

      .alias('l', 'font_license')
      .describe('l', 'The license of the generated font.')
      .default('l', 'GPL 2.0')

      .alias('d', 'dry_run')
      .describe('d',
                'Only exports a few hundreds of glyphs to the target font, ' +
                'for testing purposes.')
      .boolean('d')
      .default('d', false)

      .alias('g', 'gb2312_only')
      .describe('g', 'If set, only GB2312 Chinese glyphs are output.')
      .boolean('g')
      .default('g', false)

      .demandOption(['i', 'o', 'f'])
      .help('h')
      .alias('h', 'help')
      .alias('v', 'version')
      .argv;


// Characters to render the bitmap.
const WHITE_PIXEL = '_';
const BLACK_PIXEL = '#';


// Basic metrics.
const PIXEL_HEIGHT = argv.glyph_size_in_pixel;
const DEFAULT_ASCENT_IN_PIXELS = PIXEL_HEIGHT - 2;
const UNITS_PER_EM = 1000;
const PIXEL_SIZE = UNITS_PER_EM / PIXEL_HEIGHT;
const PIXEL_PADDING = PIXEL_SIZE / 9;
const BYTES_PER_LINE = 4;
const DESCENDER_HEIGHT = PIXEL_SIZE * 3;


/**
 * Unicode set that covers ASCII glyphs.
 * @type {Set}
 */
const ASCII_SET = (function() {
    let ret = new Set();
    for (let code = 0x20; code <= 0xFF; code++)
        ret.add(code);
    return ret;
})();


/**
 * Unicode set that covers GB2312 glyphs.
 * @type {Set}
 */
const GB2312_SET = (function() {
    let ret = new Set();
    const gbkDecoder = new TextDecoder('GBK');
    for (let byte1 = 0xA1; byte1 <= 0xA9; byte1++) {
        for (let byte2 = 0xA1; byte2 <= 0xFE; byte2++) {
            const bytes = new Uint8Array([byte1, byte2]);
            const char = gbkDecoder.decode(bytes);
            ret.add(char.charCodeAt(0));
        }
    }
    for (let byte1 = 0xB0; byte1 <= 0xF7; byte1++) {
        for (let byte2 = 0xA1; byte2 <= 0xFE; byte2++) {
            const bytes = new Uint8Array([byte1, byte2]);
            const char = gbkDecoder.decode(bytes);
            ret.add(char.charCodeAt(0));
        }
    }
    return ret;
})();


/**
 * Converts a byte to a 8-char string.
 * @param {number} byte The byte.
 * @return {string} Binary zero will be replaced with WHITE_PIXEL and
 *    one will be replaced with BLACK_PIXEL.
 */
function byteToBinaryString(byte) {
    var binaryString = parseInt(byte, 10).toString(2);
    var paddedString = ('00000000' + binaryString).substr(-8);
    return paddedString.replace(/0/g, WHITE_PIXEL).replace(/1/g, BLACK_PIXEL);
}


/**
 * Converts a glyph's bitmap to a set of binary string lines.
 * @param {Buffer} bitmap The glyph bitmap.
 * @param {number} width The pixel width of the bitmap.
 * @return {Array<string>} The renderred string lines.
 */
function bitmapToBinaryLines(bitmap, width) {
    var lines = [];
    for (let i = 0; i < bitmap.length; i += BYTES_PER_LINE) {
        let line = '';
        for (let j = 0; j < BYTES_PER_LINE; j++) {
            line += byteToBinaryString(bitmap[i + j]);
        }
        lines.push(line.slice(0, width));
    }
    return lines;
}


/**
 * Returns if the glyph should be output to the target font file.
 * @param {number} glyphCode The Unicode value of the glyph.
 * @return {boolean}
 */
function isAcceptedGlyph(glyphCode) {
    if (argv.dry_run) {
        return ASCII_SET.has(glyphCode);
    } else if (argv.gb2312_only) {
        return ASCII_SET.has(glyphCode) || GB2312_SET.has(glyphCode);
    } else {
        return true;
    }
}


/**
 * Converts screen coordinate to font coordinate.
 * @param {number} x X value in screen coordinate system.
 * @param {number} y Y value in screen coordinate system.
 * @param {glyphTop} glyphTop The top location of a glyph in font
 *     coordinate system.
 * @return {Object} x and y in font coordinate system.
 */
function ScreenXyToFontXy(x, y, glyphTop) {
    return [Math.round(x), Math.round(glyphTop - y)];
}


/**
 * Draws a square dot.
 * @param {opentype.Path} path The opentyp path.
 * @param {number} left The left location of the bound box.
 * @param {number} top The top location of the bound box.
 * @param {number} right The left location of the bound box.
 * @param {number} bottom The left location of the bound box.
 */
function drawSquareDot(path, left, top, right, bottom) {
    path.moveTo(left, top);
    path.lineTo(left, bottom);
    path.lineTo(right, bottom);
    path.lineTo(right, top);
    path.lineTo(left, top);
}

/**
 * Draws a diamond dot.
 * @param {opentype.Path} path The opentyp path.
 * @param {number} left The left location of the bound box.
 * @param {number} top The top location of the bound box.
 * @param {number} right The left location of the bound box.
 * @param {number} bottom The left location of the bound box.
 */
function drawDiamondDot(path, left, top, right, bottom) {
    const RADIUS = (right - left) / 2;
    path.moveTo(left + RADIUS, top);
    path.lineTo(left, top - RADIUS);
    path.lineTo(left + RADIUS, bottom);
    path.lineTo(right, top - RADIUS);
    path.lineTo(left + RADIUS, top);
}

/**
 * Draws a circle dot.
 * @param {opentype.Path} path The opentyp path.
 * @param {number} left The left location of the bound box.
 * @param {number} top The top location of the bound box.
 * @param {number} right The left location of the bound box.
 * @param {number} bottom The left location of the bound box.
 */
function drawCircleDot(path, left, top, right, bottom) {
    // Cubic Bézier approximation to a circular arc (1/4 of a full
    // circle): P0 = (0,1), P1 = (c,1), P2 = (1,c), P3 = (1,0)
    const C = 0.551915;
    const RADIUS = (right - left) / 2;
    path.moveTo(left + RADIUS, top);
    path.curveTo(left + RADIUS - RADIUS * C, top,
                 left, top - RADIUS + RADIUS * C,
                 left, top - RADIUS);
    path.curveTo(left, top - RADIUS - RADIUS * C,
                 left + RADIUS - RADIUS * C, bottom,
                 left + RADIUS, bottom);
    path.curveTo(left + RADIUS + RADIUS * C, bottom,
                 right, top - RADIUS - RADIUS * C,
                 right, top - RADIUS);
    path.curveTo(right, top - RADIUS + RADIUS * C,
                 left + RADIUS + RADIUS * C, top,
                 left + RADIUS, top);
}


/**
 * Vectorizes a bitmap glyph.
 * @param {Object} glyphInfo The info of the specified glyph.
 * @return {opentype.Glyph}
 */
function vectorizeGlyph(glyphInfo) {
    const width = glyphInfo.metrics.characterWidth;
    const glyphWidth = width * PIXEL_SIZE;
    const glyphTop = PIXEL_HEIGHT * PIXEL_SIZE - DESCENDER_HEIGHT;
    const xOffset = glyphInfo.metrics.leftSidedBearing * PIXEL_SIZE;
    const yOffset = (DEFAULT_ASCENT_IN_PIXELS -
                     glyphInfo.metrics.characterAscent) * PIXEL_SIZE;
    const binaryLines = bitmapToBinaryLines(glyphInfo.bitmap, width);

    const path = new opentype.Path();
    for (let y = 0; y < binaryLines.length; y++) {
        const line = binaryLines[y];
        console.log(line);

        for (let x = 0; x < line.length; x++) {
            if (line[x] == BLACK_PIXEL) {
                const x1 = xOffset + x * PIXEL_SIZE + PIXEL_PADDING;
                const y1 = yOffset + y * PIXEL_SIZE + PIXEL_PADDING;
                const [left, top] = ScreenXyToFontXy(x1, y1, glyphTop);
                const x2 = xOffset + (x + 1) * PIXEL_SIZE - PIXEL_PADDING;
                const y2 = yOffset + (y + 1) * PIXEL_SIZE - PIXEL_PADDING;
                const [right, bottom] = ScreenXyToFontXy(x2, y2, glyphTop);

                switch (argv.dot_shape) {
                case 'square':
                    drawSquareDot(path, left, top, right, bottom);
                    break;
                case 'circle':
                    drawCircleDot(path, left, top, right, bottom);
                    break;
                case 'diamond':
                    drawDiamondDot(path, left, top, right, bottom);
                    break;
                }
            }
        }
    }
    path.close();

    const fontGlyph = new opentype.Glyph({
        name: glyphInfo.name,
        unicode: glyphInfo.code,
        advanceWidth: glyphWidth,
        path: path
    });
    return fontGlyph;
}


/**
 * Converts the input PCF font to the target OpenType font.
 */
function convert() {
    var parser = new PcfParser(argv.input);
    parser.parse();

    var glyphs = [];
    for (let code = 0;
         code < parser.pcf.encodingTable.glyphIndeces.length;
         code++) {
        const index = parser.pcf.encodingTable.glyphIndeces[code];
        if (index >= 0 &&
            index < parser.pcf.metricsTable.metricsCount &&
            isAcceptedGlyph(code)) {
            glyphs.push({
                code: code,
                index: index,
                name: parser.getGlyphName(code),
                metrics: parser.getGlyphMetrics(code),
                bitmap: parser.getGlyphBitmap(code)
            });
        }
    }
    console.log('Number of glyphs to be converted: ' + glyphs.length);

    // Create the bézier paths for each of the glyphs.
    // Note that the .notdef glyph is required.
    const notdefGlyph = new opentype.Glyph({
        name: '.notdef',
        unicode: 0,
        advanceWidth: 8 * PIXEL_SIZE,
        path: new opentype.Path()
    });
    var fontGlyphs = [notdefGlyph];

    for (let i = 0; i < glyphs.length; i++) {
        console.log();
        console.log((i / glyphs.length * 100) + '% done.');
        console.log('Creating vector glyph for glyph: ' + glyphs[i].name +
                    ', U+' + glyphs[i].encoding +
                    ', W=' + glyphs[i].metrics.characterWidth);
        console.log();
        fontGlyphs.push(vectorizeGlyph(glyphs[i]));
        console.log();
    }

    console.log('Number of glyphs to be output: ' + glyphs.length);
    console.log('Outputing font glyphs to ' + argv.output);
    const font = new opentype.Font({
        familyName: argv.family_name,
        styleName: argv.font_style,
        copyright: argv.font_copyright,
        designer: argv.font_designer,
        license: argv.font_license,
        version: argv.font_version,
        unitsPerEm: UNITS_PER_EM,
        ascender: PIXEL_HEIGHT * PIXEL_SIZE - DESCENDER_HEIGHT,
        descender: -DESCENDER_HEIGHT,
        glyphs: fontGlyphs
    });

    font.download(argv.output);
    console.log('Done.');
}


convert();
