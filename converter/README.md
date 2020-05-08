# Font converter: converts PCF bitmap font to OpenType pixel font.

The released DOTTED fonts are generated with this utility, from Wen
Quan Yi bitmap fonts, that are licensed under GPL 2.0.

So far this utility is not a general-purpose font converter. It has a
few number of hard-coded parameters to fulfill the characteristics of
Wen Quan Yi or other Chinese bitmap fonts. This utility might not work
well for converting other bitmap fonts, unless some metric parameters
are updated accordingly.

## Install dependencies

```
npm install
```

## Usage

```
./pcf2opentype.js --help
```

or,

```
node pcf2opentype.js --help
```

Wen Quan Yi font usually contains over 20K glyphs. It requires a lot
of system memory to convert all the glyphs at once. Hence you might
want the following command line option to execute the converter
explicitly with `node`,

```
node --max-old-space-size=8192 pcf2opentype.js ...
```

## Release the font

This converter uses node.js module opentype.js to generate the
OpenType font file. The output file could be a bit buggy
sometimes. Before releasing the font, a font editor software may be
used to load, clean and regenerate the font. I use FontForge, which
always does well in fixing trivial issues, as well as in compressing
the font file.
