/**
 * @fileoverview JavaScript class to parse PCF font file.
 */


const Parser = require('binary-parser').Parser;
const fs = require('fs');


/**
 * Loads and parses PCF font file.
 *
 * https://www.iro.umontreal.ca/~boyer/typophile/doc/pcf-format.html
 * provides a detailed description for the PCF format.
 *
 * This class is not a general-pupose PCF parser for now. It only
 * implements a necessary subset of PCF features.
 */
class PcfParser {
    /**
     * @param {string} pcfFile The path to the PCF file to be loaded.
     */
    constructor(pcfFile) {
        /** {string} */
        this.pcfFile = pcfFile;

        /**
         * The byte buffer of the PCF file contents.
         * @type {Buffer}
         */
        this.rawBuffer = null;

        /**
         * The pcf object parsed from the file.
         * @type {Object}
         */
        this.pcf = null;
    }

    /**
     * Parses the PCF file.
     * @return {Object} The parsed object.
     */
    parse() {
        console.log('Reading ' + this.pcfFile + '...');
        this.rawBuffer = fs.readFileSync(this.pcfFile);
        console.log('Read ' + this.rawBuffer.length + ' bytes in total.');

        const headerTableParser = new Parser()
            .endianess('little')
            .uint32('type')
            .uint32('format')
            .uint32('size')
            .uint32('offset');

        const mainParser = new Parser()
            .endianess('little')
            .string('header', {
                length: 4
            })
            .uint32('tableCount')
            .array('tocEntry', {
                type: headerTableParser,
                length: function() {
                    return this.tableCount;
                }
            });

        console.log('Parsing PCF format...');
        this.pcf = mainParser.parse(this.rawBuffer);
        if (this.pcf.header != '\u0001fcp') {
            throw new Error('Not a valid PCF file.');
        }

        for (let table of this.pcf.tocEntry) {
            table.typeString = PcfParser.tableTypeToString(table.type);
            table.formatString = PcfParser.tableFormatToString(table.format);

            switch (table.typeString) {
            case 'PCF_GLYPH_NAMES':
                this.pcf.glyphNameTable = this.parseGlyphNameTable(
                    table.offset, table.format);
                break;
            case 'PCF_BDF_ENCODINGS':
                this.pcf.encodingTable = this.parseEncodingTable(
                    table.offset, table.format);
                break;
            case 'PCF_METRICS':
                this.pcf.metricsTable = this.parseMetricsTable(
                    table.offset, table.format);
                break;
            case 'PCF_BITMAPS':
                this.pcf.bitmapTable = this.parseBitmapTable(
                    table.offset, table.format);
                break;
            }
        }
        console.log('Parsed ' +
                    this.pcf.metricsTable.metricsCount +
                    ' glyphs in total.');
        return this.pcf;
    }

    /**
     * Converts PCF table type to string.
     * @param {number} type The table type.
     * @return {string}
     */
    static tableTypeToString(type) {
        var ret = [];
        if (type & 1 << 0)
            ret.push('PCF_PROPERTIES');
        if (type & 1 << 1)
            ret.push('PCF_ACCELERATORS');
        if (type & 1 << 2)
            ret.push('PCF_METRICS');
        if (type & 1 << 3)
            ret.push('PCF_BITMAPS');
        if (type & 1 << 4)
            ret.push('PCF_INK_METRICS');
        if (type & 1 << 5)
            ret.push('PCF_BDF_ENCODINGS');
        if (type & 1 << 6)
            ret.push('PCF_SWIDTHS');
        if (type & 1 << 7)
            ret.push('PCF_GLYPH_NAMES');
        if (type & 1 << 8)
            ret.push('PCF_BDF_ACCELERATORS');
        return ret.join(' | ');
    }

    /**
     * Converts PCF table format to string.
     * @param {number} format The table format.
     * @return {string}
     */
    static tableFormatToString(format) {
        var ret = [];
        const value = format & 0xFFFFFF00;
        if (value == 0x200)
            ret.push('PCF_INKBOUNDS');
        else if (value == 0x100)
            ret.push('PCF_COMPRESSED_METRICS');
        else
            ret.push('PCF_DEFAULT_FORMAT');

        if (format & 3 << 0 == 3)
            ret.push('PCF_GLYPH_PAD_MASK');
        if (format & 1 << 2)
            ret.push('PCF_BYTE_MASK');
        if (format & 1 << 3)
            ret.push('PCF_BIT_MASK');
        if (format & 3 << 4 == 3 << 4)
            ret.push('PCF_SCAN_UNIT_MASK');
        return ret.join(' | ');
    }

    /**
     * If the table format is PCF_COMPRESSED_METRICS.
     * @param {number} format The table format.
     * @return {boolean}
     */
    static isCompressedMetrics(format) {
        const value = format & 0xFFFFFF00;
        return value == 0x100;
    }

    /**
     * Returns the byte endianess of the specified table format.
     * @param {number} format The table format.
     * @return {Array<string>} The endianess string and the endianess
     *     suffix string.
     */
    static getEndianessFromFormat(format) {
        var endianess = format & 1 << 2 ? 'big' : 'little';
        var endianessSuffix = format & 1 << 2 ? 'be' : 'le';
        return [endianess, endianessSuffix];
    }

    /**
     * Parses the glyph name table.
     * @param {number} offset The offset to locate the table in the raw buffer.
     * @param {number} format The table format.
     * @return {Object} The parsed object.
     */
    parseGlyphNameTable(offset, format) {
        const [endianess, endianessSuffix] =
              PcfParser.getEndianessFromFormat(format);

        const tableParser = new Parser()
            .seek(offset)
            .endianess('little')    // The first value is always
                                    // little endian.
            .uint32('format')
            .endianess(endianess)   // The endianess of the following
                                    // numbers are specified by the
                                    // table format.
            .uint32('glyphCount')
            .array('offsets', {
                type: 'uint32' + endianessSuffix,
                length: function() {
                    return this.glyphCount;
                }
            })
            .uint32('stringSize');

        var table = tableParser.parse(this.rawBuffer);

        table.strings = [];
        var baseOffset = 4 * 2 + 4 * table.glyphCount + 4;
        for (const stringOffset of table.offsets) {
            const stringParser = new Parser()
                  .seek(offset + baseOffset + stringOffset)
                  .string('string', {
                      zeroTerminated: true
                  });
            var stringObj = stringParser.parse(this.rawBuffer);
            table.strings.push(stringObj.string);
        }
        return table;
    }

    /**
     * Parses the encoding table.
     * @param {number} offset The offset to locate the table in the raw buffer.
     * @param {number} format The table format.
     * @return {Object} The parsed object.
     */
    parseEncodingTable(offset, format) {
        const [endianess, endianessSuffix] =
              PcfParser.getEndianessFromFormat(format);

        const tableParser = new Parser()
              .seek(offset)
              .endianess('little')
              .uint32('format')
              .endianess(endianess)
              .uint16('minCharOrByte2')
              .uint16('maxCharOrByte2')
              .uint16('minByte1')
              .uint16('maxByte1')
              .uint16('defaultChar')
              .array('glyphIndeces', {
                  type: 'uint16' + endianessSuffix,
                  length: function() {
                      return (this.maxCharOrByte2 - this.minCharOrByte2 + 1) *
                          (this.maxByte1 - this.minByte1 + 1);
                  }
              });
        return tableParser.parse(this.rawBuffer);
    }

    /**
     * Parses the metrics table.
     * @param {number} offset The offset to locate the table in the raw buffer.
     * @param {number} format The table format.
     * @return {Object} The parsed object.
     */
    parseMetricsTable(offset, format) {
        const [endianess, endianessSuffix] =
              PcfParser.getEndianessFromFormat(format);

        var entryParser = new Parser();
        var tableParser = new Parser();
        var table = null;

        if (PcfParser.isCompressedMetrics(format)) {
            // Compressed metrics format.
            entryParser
                .endianess(endianess)
                .uint8('leftSidedBearing')
                .uint8('rightSideBearing')
                .uint8('characterWidth')
                .uint8('characterAscent')
                .uint8('characterDescent');
            tableParser
                .seek(offset)
                .endianess('little')
                .uint32('format')
                .endianess(endianess)
                .uint16('metricsCount')
                .array('metrics', {
                    type: entryParser,
                    length: function() {
                        return this.metricsCount;
                    }
                });
            table = tableParser.parse(this.rawBuffer);
            for (let entry of table.metrics) {
                entry.leftSidedBearing -= 0x80;
                entry.rightSideBearing -= 0x80;
                entry.characterWidth -= 0x80;
                entry.characterAscent -= 0x80;
                entry.characterDescent -= 0x80;
                entry.characterAttributes = 0;
            }
        } else {
            // Uncompressed metrics format.
            entryParser
                .endianess(endianess)
                .uint16('leftSidedBearing')
                .uint16('rightSideBearing')
                .uint16('characterWidth')
                .uint16('characterAscent')
                .uint16('characterDescent')
                .uint16('characterAttributes');
            tableParser
                .seek(offset)
                .endianess('little')
                .uint32('format')
                .endianess(endianess)
                .uint32('metricsCount')
                .array('metrics', {
                    type: entryParser,
                    length: function() {
                        return this.metricsCount;
                    }
                });
            table = tableParser.parse(this.rawBuffer);
        }
        return table;
    }

    /**
     * Parses the bitmap table.
     * @param {number} offset The offset to locate the table in the raw buffer.
     * @param {number} format The table format.
     * @return {Object} The parsed object.
     */
    parseBitmapTable(offset, format) {
        const [endianess, endianessSuffix] =
              PcfParser.getEndianessFromFormat(format);

        const tableParser = new Parser()
              .seek(offset)
              .endianess('little')
              .uint32('format')
              .endianess(endianess)
              .uint32('glyphCount')
              .array('offsets', {
                  type: 'uint32' + endianessSuffix,
                  length: function() {
                      return this.glyphCount;
                  }
              })
              .array('bitmapSizes', {
                  type: 'uint32' + endianessSuffix,
                  length: 4
              });

        var table = tableParser.parse(this.rawBuffer);
        table.bitmapSize = table.bitmapSizes[table.format & 3];
        table.bitmapsBaseOffset = offset + 4 * 2 + 4 * table.glyphCount + 4 * 4;
        return table;
    }

    /**
     * Given a glyph's Unicode value, returns its glyph name.
     * @param {number} glyphCode The Unicode value of the glyph.
     * @return {string}
     */
    getGlyphName(glyphCode) {
        if (this.pcf == null) {
            throw new Error('The PCF has not been parsed yet.');
        }
        const glyphIndex = this.pcf.encodingTable.glyphIndeces[glyphCode];
        return this.pcf.glyphNameTable.strings[glyphIndex];
    }

    /**
     * Given a glyph's Unicode value, returns its metrics.
     * @param {number} glyphCode The Unicode value of the glyph.
     * @return {Object}
     */
    getGlyphMetrics(glyphCode) {
        if (this.pcf == null) {
            throw new Error('The PCF has not been parsed yet.');
        }
        const glyphIndex = this.pcf.encodingTable.glyphIndeces[glyphCode];
        return this.pcf.metricsTable.metrics[glyphIndex];
    }

    /**
     * Given a glyph's Unicode value, returns the byte buffer of its
     * bitmap.
     * @param {number} glyphCode The Unicode value of the glyph.
     * @return {Buffer}
     */
    getGlyphBitmap(glyphCode) {
        if (this.pcf == null) {
            throw new Error('The PCF has not been parsed yet.');
        }
        const glyphIndex = this.pcf.encodingTable.glyphIndeces[glyphCode];
        var bitmapOffset = this.pcf.bitmapTable.offsets[glyphIndex];
        var bitmapEnd = glyphIndex < this.pcf.bitmapTable.glyphCount - 1 ?
            this.pcf.bitmapTable.offsets[glyphIndex + 1] :
            this.pcf.bitmapTable.bitmapSize;
        bitmapOffset += this.pcf.bitmapTable.bitmapsBaseOffset;
        bitmapEnd += this.pcf.bitmapTable.bitmapsBaseOffset;
        return this.rawBuffer.slice(bitmapOffset, bitmapEnd);
    }
};


module.exports.PcfParser = PcfParser;
