## Dev tips

If `npm run dev` is recompiling slowly because the project lives inside a
OneDrive folder, set `NEXT_DIST_DIR` to a local path outside OneDrive:

```bash
# windows (powershell)
$env:NEXT_DIST_DIR = "c:/dev-cache/print-room-portal/.next"
```

Then run `npm run dev` as usual. The `.next` build cache lives at the
configured location instead of the project tree.
