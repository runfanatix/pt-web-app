#!/bin/zsh
# download.sh <workdir>
# Reads "idx URL" lines on stdin (Higgsfield result_url values), saves raw/<idx>.png
# and a 1200px JPEG for canvas upload at up/<idx>.jpg.
W=$1
[ -z "$W" ] && { echo "usage: download.sh <workdir> < urls.txt"; exit 1; }
mkdir -p "$W/raw" "$W/up"
while read -r i url; do
  [ -z "$i" ] && continue
  ext=${url##*.}
  if curl -sfo "$W/raw/$i.$ext" "$url"; then
    if [ "$ext" = "svg" ]; then cp "$W/raw/$i.svg" "$W/up/$i.svg"
    else sips -s format jpeg -s formatOptions 88 -Z 1200 "$W/raw/$i.$ext" --out "$W/up/$i.jpg" >/dev/null; fi
  else
    echo "fail $i"
  fi
done
ls "$W/up" | wc -l
