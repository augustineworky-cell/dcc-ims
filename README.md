# GoodsGuru (DCC IMS)

Inventory for DCC Supply Chain & Distribution. Plain HTML, CSS and JS, no build step. Same setup as Order to Dispatch:
one `index.html`, hash routing in `app.js`, keys in `config.js`.

## Pages (routes)
`#/login` · `#/dashboard` · `#/stock` · `#/receive` · `#/issue` · `#/transfer` · `#/count` · `#/reorder` · `#/settings`

Everything except `#/login` needs a signed-in user. Each page is a placeholder for now. To build a page, add its
screen in `renderShell` in `app.js` (or a function per page, like Order to Dispatch does).

## Preview mode
While `config.js` has no Supabase keys, any valid-looking email and a 6+ character password opens the pages with a
yellow "Preview mode" banner. Nothing is saved and there is no data.

## Turn on real sign-in (backend already installed; just paste the key)
1. Run `stockly_backend.sql` in the IMS Supabase project (SQL Editor).
2. In Supabase: Project Settings, API. Copy the Project URL and the **publishable** key (never the secret key).
3. Paste them into `config.js`, commit, push. Vercel redeploys.
4. Sign in with the login you made under Authentication, Users. It must be linked in `profiles` (the SQL does this).

## Before launch
- The thought cloud line "I get back 8 hours of my day." and the owner's photo (`man.webp`) need Sidharth sir's okay.
- Product name "GoodsGuru" is a working name.
- One login across Atlas and GoodsGuru is a later step. Today GoodsGuru signs in with its own Supabase project.

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000
