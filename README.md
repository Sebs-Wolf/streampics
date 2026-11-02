# StreamPics

A local Node.js + Express companion that turns Twitch moments into collectible photos and interactive albums.

## Collection and creator workspace

The `/` collection is exclusively for browsing: an album shelf and item inspection. Albums start closed. Select one, rotate or zoom the cover, then open it to turn pages. Select a photo to inspect it separately. Drag or use arrow keys to rotate, scroll or use the zoom buttons to zoom, and use Flip to inspect the reverse. Holo and prismatic card lighting follows the card viewing angle. Reset view restores the original orientation.

`/studio` is the Capture workspace, with live frame, format, and foil previews and a visual frame browser. `/studio?tab=library` is Albums & photos: create and manage albums, preview covers, edit photos and stickers, and export. Managing an album does not change the capture destination. `/designs` holds AI design generation and artwork previews. Frame actions explicitly set capture defaults; cover actions open an unsaved preview in Albums & photos. `/connections` holds OBS, Twitch, ChatGPT, event triggers, and overlay setup. Browsing a photo never opens its editor. Existing single-album data migrates into the multi-album model without losing photos, metadata, or credentials.

Photos support a true square image crop inside an instant-photo border, or the complete source inside a 16:9 composition. Original captures are retained. TCG cards use a dedicated 630 × 880 canvas (63:88 ratio), name, power, ability/flavor text, rarity, attribution, and card back. Matte, holographic, and prismatic finishes persist with the photo. The interactive sheen is CSS lighting; exported cards retain a static vector foil treatment. Exports are 1200 × 1440 for instant photos, 1920 × 1080 for widescreen photos, and 1260 × 1760 for TCG cards.

**Copy viewing link** in Creator Studio creates a separate `/view/:token` read-only collection page with no creator navigation or editor code. Its gallery API includes only the selected album, its photos, and referenced designs. Hidden viewer contributions, capture scene names, credentials, settings, and activity records are excluded. This is currently a **local preview link**, reachable only from this computer. Remote audience sharing still needs a hosted gallery and authenticated publishing from the local companion; do not expose the local Express admin server publicly. Creating a viewing link does not publish anything externally.

## Run

Use Node.js 20 or newer. Run `npm install`, copy `.env.example` to `.env` if needed, and run `npm start`. Open [http://localhost:3000](http://localhost:3000). Add your own Twitch Client ID and client secret to `.env`. Restart the server after changing environment variables. `npm run dev` watches server files during development.

## Connect your stream

In OBS Studio, open **Tools → WebSocket Server Settings**, enable the server, and keep authentication enabled. In StreamPics's **Connect** view, enter `ws://127.0.0.1:4455` and the OBS password. The app asks OBS for its current program scene and calls `GetSourceScreenshot`; a browser source alone cannot read OBS's rendered stream. Capture uses a PNG at 1600 pixels wide. It captures the scene OBS is rendering when the request reaches OBS, rather than the delayed Twitch playback frame.

Create a **Confidential** Twitch application, add `http://localhost:3000/auth/twitch/callback` to its OAuth redirect URLs, and fill in `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in `.env`. Connect with Twitch as the broadcaster. The app requests `bits:read` and `channel:read:subscriptions`, then opens EventSub over WebSocket; no public tunnel is needed. Eligible channel/account permissions are required for Bits and subscription events. Subscription registration failures appear in Connect.

Enable the Cheer and/or subscription capture switches and save triggers. Cheers support a minimum Bits threshold. Subscriptions, gift batches, and resub messages retain the viewer and quantity/tier. The app does not invent a monetary value for subscriptions, nor process cash donations from external tipping services. Anonymous events stay anonymous. Per-recipient gift subscription notifications are ignored because the gift batch produces the photo. Captures never spend additional viewer currency.

Use **Capture moment** in Creator Studio for a manual capture. Edits persist when **Save changes** is pressed; export includes the current unsaved preview. Change the active album to route future manual and Twitch-triggered captures. Set album covers and album/binder styling in Albums & photos.

The optional **Copy overlay URL** action gives you an OBS browser-source URL. Set its dimensions to 1920 × 1080 and leave it running. It reveals new live captures for roughly ten seconds, respects attribution, and does not replay the latest photo when reloaded. Keep this URL private: it is a capability for reading the latest photo. The capture sequence clears its countdown and previous photo reveal before requesting the OBS frame, then plays the shutter effect afterward. Other on-stream graphics remain part of the captured OBS scene.

## ChatGPT design tools

Choose **Continue with ChatGPT** in Connect or Studio. Eligible accounts can authorize ChatGPT plan usage through the documented local/open-source dynamic registration flow. No OpenAI API key or ChatGPT client secret is required. The first sign-in creates a stable local host identity and registration; subsequent sign-ins reuse it. OAuth uses state, PKCE, a nonce, signature-verified ID tokens, and refresh-token rotation. Credentials remain on the server, never in browser state.

Designs discovers the account's available models. Describe a frame, cover, or sticker, choose its canvas, and create the design. The app sends text, never stream screenshots, to the public Responses API using `store: false` and `stream: true`, and requires `response.completed`.

New designs are **freeform HTML/CSS artwork**, not palette/motif selections. The model can create original compositions with layered illustrations, textures, gradients, ornamentation, inline SVG, typography, and self-contained data images. A 180 KB output limit and fixed canvas dimensions keep rendering bounded. Static markup is required: scripts, external URLs, forms, and embeds are excluded. Existing palette-based designs remain available as legacy themes.

Artwork renders in an isolated offline headless Chrome/Edge context with page JavaScript disabled, a restrictive CSP, and network requests blocked. Model markup is never mounted into the StreamPics UI. The renderer extracts photo/text slot bounds and computed typography, then produces PNG layers. Frames have independent background/foreground layers so ornamentation can sit over the photo; the photo, title, caption, and attribution stay editable. Album covers use their own generated artwork instead of the built-in cover layout. Stickers use the full generated silhouette. HTML/CSS animations are frozen into static artwork; object inspection and foil lighting remain interactive in the app. This creates much richer procedural artwork, but it does not turn a text model into a raster image-generation model.

Install Chrome or Edge to render HTML artwork. The renderer detects standard Windows installations or `/usr/bin/chromium` and `/usr/bin/google-chrome`. Set `STREAMPICS_BROWSER` to another executable path if necessary. There is no separate browser download during installation. Generated assets are saved in `data/designs/`; embedded image layers also travel with saved design records for consistent SVG/PNG export and collection viewing.

The optional `/api/designs/import` endpoint accepts PNG, JPEG, and WebP files up to 12 MB, with a 16-megapixel decode limit. Generate artwork directly in ChatGPT with your subscription, download it, and import it as a cover, sticker, or frame background. Transparent PNGs work for cutout stickers. Imported frame backgrounds use the chosen canvas, with an editable photo opening and text placed over the artwork. For original generated frame layouts, use the HTML/CSS path, which places these slots as part of the composition.

The [Sign in with ChatGPT plan-usage preview](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) still excludes image generation. Eligible Pro and Business plans can separately activate [subscription API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits) that cover the Images API; that route requires linking an API organization and using its API key. StreamPics does not currently call the Images API or silently fall back to separately billed generation. Plan eligibility, account limits, and provider availability apply. Disconnecting ChatGPT removes its local credential record; manage or revoke remote permissions in ChatGPT settings.

## Data and operating limits

Photos, original captures, settings, generated designs, OAuth registrations, and tokens live in the ignored `data/` directory on this computer. Back up that directory to preserve the collection, and treat the backup as sensitive because it includes credentials. Metadata writes are serialized and replaced atomically. Unix writes request owner-only permissions; Windows relies on the account's directory ACL. This is a single-user local companion, bound to IPv4 loopback, with Host/Origin validation and a required custom header on mutations. It is not prepared for shared public hosting.

EventSub message IDs are retained in a bounded persistent deduplication list. Captures are serialized, with at most twelve pending operations. Live capture failures are recorded in the activity feed, with no silent sample fallback. Events beyond the queue bound fail visibly. Capture retries would produce a later frame, so failed captures are not silently retried. Twitch has no replay for events missed during disconnection. EventSub reconnects, keepalive checks, token refresh, and hourly token validation are implemented. Connecting to OBS is explicit after a disconnect; the app does not continuously retry an incorrect password.

**Add sample captures** in Creator Studio adds clearly labeled fictional stream screenshots to the active album: competitive gameplay, a cozy adventure, and a Just Chatting reaction, complete with webcam/broadcast overlays. These AI-generated samples let judges explore the experience without OBS or paid Twitch events. Samples are persisted, can be edited, and never appear in the stream overlay. Original PNGs and their generation prompts are included in `public/assets/`.

## Validation

Run `npm run check` and `npm test`. Tests cover persistence, manual capture with a test OBS adapter, failed-capture behavior, editable metadata, hidden attribution in the overlay, local request protections, anonymous and gifted subscription handling, safe vector parameters, stable host identity, and OAuth transaction replay/expiry checks. Tests also cover freeform HTML validation, real offline HTML/CSS rendering, independent artwork layers, editable slots, transparency, imported raster images, and composition for export. Browser QA covers sample albums, text and sticker editing, and PNG download. These checks do not substitute for live OBS, Twitch, or ChatGPT account validation.

## Hackathon delivery

The [official rules](https://twitchcon-codex.devpost.com/rules) require a new project built with Codex that connects to Twitch, an accessible source repository with run instructions, an English project description explaining Codex use, the building chat's Codex session ID, and a public YouTube demo of less than three minutes. Show the app functioning with Twitch and show how it was built with Codex. Confirm eligibility and the deadline directly on Devpost before submission; do not rely on a cached countdown.

A useful demo sequence: connect OBS and Twitch, capture a real stream moment, edit its card text and stickers, show a genuine Cheer/sub trigger with attribution, generate a custom HTML/CSS design using ChatGPT, then close the album and reopen it. Use original or authorized stream imagery/music in the recording. In this chat, `/status` supplies the session ID for the submission. Publishing this source repository does not submit a Devpost entry.

Primary integration references: [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md), [Twitch EventSub WebSockets](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), [ChatGPT sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [ChatGPT models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

Streamers can select a text font in Capture defaults, each photo editor, and each album cover editor. Font changes preview immediately, persist with photos/covers, and carry through gallery viewing, overlays, and PNG export. Choose Original design font to keep the template or AI artwork typography. Modern choices are bundled locally; the classic choices use system font stacks. Both work without external font services.

Modern font choices include locally bundled Space Grotesk, Outfit, Sora, and JetBrains Mono, distributed under their included SIL licenses in `public/fonts/`. Photo PNG export uses the local Chrome/Edge renderer so these fonts stay intact. Album covers use HTML/CSS compositions with scalable live typography, including generated cover image layers; default covers include Silver screen (black bookcloth and silver foil), Denim replay (stitched denim), Guild archive (leather), Sunroom (linen and pressed botanicals), Wayfinder (canvas travel journal), and Keepsake vault (embossed leather and brass clasp). Night shift, Neon signal, Afterglow, and Golden hour are grouped as Orbital series variants.

Default emoji stickers use locally bundled Twemoji v17.0.3 SVG artwork (CC BY 4.0), with white vector outlines. They do not depend on operating-system emoji fonts or bitmap glyphs. Attribution and licenses are available at `/credits.html` and `public/assets/emoji/`. User-created stickers remain separate.

In **Capture → On-stream capture**, enable **3–2–1 countdown** and/or **Shutter animation**, then save capture defaults. Copy the browser source URL into OBS at 1920 × 1080 and keep it active in the program scene. Manual and Twitch-triggered captures use the same sequence: countdown, clear the overlay, grab the program frame, shutter animation, and photo reveal. The countdown and shutter are omitted from the saved image.


## Test Cheers and subscriptions without Affiliate

Install the official [Twitch CLI](https://dev.twitch.tv/docs/cli/). The `npm run twitch -- ...` launcher uses a portable Windows CLI under `data/tools/twitch-cli/bin/` when available, or the `twitch` executable on PATH. In one terminal run:

```powershell
npm run twitch -- event websocket start-server
```

In **Connections → Test with Twitch CLI**, leave the local port at `8080` and click **Connect CLI test server**. No Twitch login, client secret, Affiliate status, or real purchase is needed. Connect OBS, enable the Cheer/subscription capture switches, set a suitable minimum Bits threshold, and save triggers. In another terminal run:

```powershell
npm run twitch -- event trigger channel.cheer --transport=websocket
npm run twitch -- event trigger channel.subscribe --transport=websocket
npm run twitch -- event trigger channel.subscription.gift --transport=websocket
npm run twitch -- event trigger channel.subscription.message --transport=websocket
```

Use the CLI server's default settings, without `--require-subscription`; StreamPics does not register mock subscriptions. The example trigger commands target the CLI's default port, `8080`. The test connection only accepts a numeric loopback port and never forwards real Twitch credentials. Mock events use the same normalization, deduplication, trigger filters, capture queue, OBS countdown/shutter, attribution, and overlay path as live events. They take real OBS screenshots, save to the active capture album, start with the title **CLI test moment**, and appear as **[TEST]** in capture activity. Test status is retained in trigger metadata even if you rename the photo. Samples added through **Add sample captures** remain a separate feature.

Test mode temporarily replaces the production Twitch listener, preserves your saved Twitch login, and does not persist across app restarts. Click **Exit test mode**, then reconnect with Twitch to resume real events. The [official WebSocket testing guide](https://dev.twitch.tv/docs/cli/websocket-event-command/) describes mock server behavior and reconnect testing.

Built-in photo styles include **CRT replay**, with a rounded retro monitor bezel, scanlines, and hardware controls, and **Loot receipt**, with thermal-paper edges, a barcode, and drop details. Both have distinct square-crop and 16:9 layouts, keep titles/captions and attribution editable, and remain vector-sharp in previews and exports. Their stored template IDs remain `postcard` and `ticket` for existing photo compatibility.

Album inspection uses nearly the full viewport. **Hide details** removes the sidebar while album open/close, page navigation, zoom, and flip controls stay available. Zoom uses fixed model dimensions so pages, photos, text, and binding scale uniformly. Flipping an open album reveals two portrait cover boards: a matching quiet back cover and the original front cover, without stretching the front design across the spread.

Double-click a closed album cover to open it. Each page staggers its two photos toward the top left and bottom right, with proportional margins and separation. The 3D album has front/back boards plus a four-sided page block and spine, so its thickness remains visible when rotated edge-on.
