#!/usr/bin/env node --max-old-space-size=8192


const { PcfParser } = require('./pcf-parser');
const opentype = require('opentype.js');
const yargs = require('yargs');


// Supported font styles.
const SUPPORTED_FONT_STYLES = ['square', 'circle'];
const FONT_STYLE_NAMES = {
    'square': 'Square Regular',
    'circle': 'Circle Regular'
};


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

      .alias('s', 'font_style')
      .choices('s', SUPPORTED_FONT_STYLES)
      .describe('s', 'Choose the font style.')
      .default('s', 'square')

      .alias('f', 'family_name')
      .describe('f', 'The family name of the generated font.')

      .alias('r', 'font_version')
      .describe('r', 'The version of the generated font.')
      .default('r', '0.1')

      .alias('e', 'font_designer')
      .describe('e', 'The designer of the generated font.')
      .default('e', 'wixette')

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
    return [x, glyphTop - y];
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
                const left = xOffset + x * PIXEL_SIZE + PIXEL_PADDING;
                const top = yOffset + y * PIXEL_SIZE + PIXEL_PADDING;
                const [fLeft, fTop] = ScreenXyToFontXy(left,
                                                       top,
                                                       glyphTop);
                const right = xOffset + (x + 1) * PIXEL_SIZE - PIXEL_PADDING;
                const bottom = yOffset + (y + 1) * PIXEL_SIZE - PIXEL_PADDING;
                const [fRight, fBottom] = ScreenXyToFontXy(right,
                                                           bottom,
                                                           glyphTop);
                path.moveTo(fLeft, fTop);
                path.lineTo(fLeft, fBottom);
                path.lineTo(fRight, fBottom);
                path.lineTo(fRight, fTop);
                path.lineTo(fLeft, fTop);
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

    console.log('Outputing font glyphs to ' + argv.output);
    const font = new opentype.Font({
        familyName: argv.family_name,
        styleName: FONT_STYLE_NAMES[argv.font_style],
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
