#!/usr/bin/env bash
# Builds the in-browser converter: public/wasm/vss2drawio.mjs + vss2drawio.wasm.
#
# Cross-compiles libxml2, librevenge and libvisio with Emscripten, packs a trimmed
# ICU data file holding only the Windows code pages libvisio opens, and links
# src-native/vss2drawio.cpp against them.
#
# Requirements: emsdk activated (emcc on PATH), icupkg (apt: icu-devtools),
# curl, make, gperf, python3.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WASM_WORK_DIR:-$ROOT/.wasm-build}"
PREFIX="$WORK/prefix"
OUT="$ROOT/public/wasm"
JOBS="${JOBS:-$(nproc)}"

LIBXML2_VERSION=2.13.9
LIBREVENGE_VERSION=0.0.5
LIBVISIO_VERSION=0.1.11

for tool in emcc emconfigure embuilder icupkg curl make gperf; do
  command -v "$tool" >/dev/null || { echo "error: '$tool' not found on PATH" >&2; exit 1; }
done

mkdir -p "$WORK/src" "$PREFIX" "$OUT"
SYSROOT="$(em-config CACHE)/sysroot"
CXXFLAGS_WASM="-O2 -fwasm-exceptions"

echo "==> Emscripten ports (zlib, boost headers, ICU)"
embuilder build zlib boost_headers icu

fetch() { # url dir
  local url="$1" dir="$2"
  if [ ! -d "$WORK/src/$dir" ]; then
    curl -fsSL "$url" | tar -xJ -C "$WORK/src"
    # Old autotools config.sub does not know the emscripten host triple.
    cp "$WORK/src/libxml2-$LIBXML2_VERSION/config.sub" "$WORK/src/$dir/" 2>/dev/null || true
  fi
}

fetch "https://download.gnome.org/sources/libxml2/${LIBXML2_VERSION%.*}/libxml2-$LIBXML2_VERSION.tar.xz" "libxml2-$LIBXML2_VERSION"
fetch "https://sourceforge.net/projects/libwpd/files/librevenge/librevenge-$LIBREVENGE_VERSION/librevenge-$LIBREVENGE_VERSION.tar.xz/download" "librevenge-$LIBREVENGE_VERSION"
fetch "https://dev-www.libreoffice.org/src/libvisio/libvisio-$LIBVISIO_VERSION.tar.xz" "libvisio-$LIBVISIO_VERSION"

if [ ! -f "$PREFIX/lib/libxml2.a" ]; then
  echo "==> libxml2"
  cd "$WORK/src/libxml2-$LIBXML2_VERSION"
  emconfigure ./configure --prefix="$PREFIX" --host=wasm32-unknown-emscripten \
    --disable-shared --enable-static --without-python --without-zlib --without-lzma \
    --without-iconv --without-icu --without-http --without-ftp --without-threads \
    --without-modules --without-catalog --without-debug --without-readline --without-history
  emmake make -j"$JOBS" install
fi

if [ ! -f "$PREFIX/lib/librevenge-0.0.a" ]; then
  echo "==> librevenge"
  cd "$WORK/src/librevenge-$LIBREVENGE_VERSION"
  emconfigure ./configure --prefix="$PREFIX" --host=wasm32-unknown-emscripten \
    --disable-shared --enable-static --disable-tests --without-docs --disable-werror --disable-debug \
    CXXFLAGS="$CXXFLAGS_WASM" CPPFLAGS="-I$SYSROOT/include" \
    ZLIB_CFLAGS="-I$SYSROOT/include" ZLIB_LIBS="-lz"
  emmake make -j"$JOBS" install
fi

if [ ! -f "$PREFIX/lib/libvisio-0.1.a" ]; then
  echo "==> libvisio"
  cd "$WORK/src/libvisio-$LIBVISIO_VERSION"
  emconfigure ./configure --prefix="$PREFIX" --host=wasm32-unknown-emscripten \
    --disable-shared --enable-static --disable-tests --disable-tools --without-docs \
    --disable-werror --disable-debug \
    CXXFLAGS="$CXXFLAGS_WASM" CPPFLAGS="-I$SYSROOT/include" \
    ICU_CFLAGS="-I$SYSROOT/include" ICU_LIBS="-licu_common" \
    REVENGE_CFLAGS="-I$PREFIX/include/librevenge-0.0" REVENGE_LIBS="-L$PREFIX/lib -lrevenge-0.0" \
    LIBXML_CFLAGS="-I$PREFIX/include/libxml2" LIBXML_LIBS="-L$PREFIX/lib -lxml2"
  emmake make -j"$JOBS" install
fi

echo "==> trimmed ICU data"
# The ICU port links only stub data, and the full icudt68l.dat is ~27 MB.
# Keep the converters for the code pages libvisio passes to ucnv_open().
ICU_DAT_SRC="$(em-config CACHE)/ports/icu/icu/source/data/in/icudt68l.dat"
ICU_WORK="$WORK/icudata"
rm -rf "$ICU_WORK" && mkdir -p "$ICU_WORK/items"
cat > "$ICU_WORK/list.txt" <<'EOF'
cnvalias.icu
ibm-5346_P100-1998.cnv
ibm-5347_P100-1998.cnv
ibm-5348_P100-1997.cnv
ibm-5349_P100-1998.cnv
ibm-5350_P100-1998.cnv
ibm-9447_P100-2002.cnv
ibm-9448_X100-2005.cnv
ibm-9449_P100-2002.cnv
ibm-5354_P100-1998.cnv
windows-874-2000.cnv
ibm-943_P15A-2003.cnv
windows-936-2000.cnv
ibm-1386_P100-2001.cnv
windows-949-2000.cnv
ibm-1363_P11B-1998.cnv
windows-950-2000.cnv
ibm-1373_P100-2002.cnv
EOF
icupkg -x "$ICU_WORK/list.txt" -d "$ICU_WORK/items" "$ICU_DAT_SRC"
icupkg -s "$ICU_WORK/items" -a "$ICU_WORK/list.txt" new "$ICU_WORK/icudt68l.dat"

echo "==> vss2drawio.wasm"
em++ -O3 -std=c++17 -fwasm-exceptions \
  -sUSE_ZLIB=1 -sUSE_BOOST_HEADERS=1 -sUSE_ICU=1 \
  -I"$PREFIX/include/libvisio-0.1" -I"$PREFIX/include/librevenge-0.0" \
  "$ROOT/src-native/vss2drawio.cpp" \
  -L"$PREFIX/lib" -lvisio-0.1 -lrevenge-stream-0.0 -lrevenge-generators-0.0 -lrevenge-0.0 -lxml2 \
  --embed-file "$ICU_WORK/icudt68l.dat@/icu/icudt68l.dat" \
  --no-entry \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createVss2drawio \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=1MB \
  -sEXPORTED_FUNCTIONS=_v2d_convert,_v2d_last_error,_v2d_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8 \
  -o "$OUT/vss2drawio.mjs"

ls -la "$OUT"
