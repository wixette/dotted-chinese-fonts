# Utility to convert bitmap fonts to OpenType fonts

The released Dotted Chinese Pixel Fonts are generated with this
utility, based on WenQuanYi bitmap fonts.

So far this utility is not a general-purpose font converter. It has a
few hard-coded parameters to fulfill the characteristics of WenQuanYi
or other Chinese bitmap fonts. It might not work well for converting
non-Chinese bitmap fonts, unless the metric parameters are updated
accordingly.

## Install the dependencies

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

WenQuanYi font usually covers over 20K Unicode glyphs. It requires
4~5GB system memory to vectorize all those glyphs. To avoid exceeding
V8's memory limit, `node.js` has a useful command line option
`--max-old-space-size`. For example,

```
node --max-old-space-size=8192 pcf2opentype.js ...
```

## Release the fonts

The converter uses JavaScript module opentype.js to generate OpenType
font file. The output file could be a bit buggy sometimes. For solving
this, we can use font editor software to load, verify, clean and
regenerate the font file.

I use FontForge to release the generated fonts. FontForge does well in
verifying and fixing format issues, and making the output file ready
for Windows, macOS and Linux.
