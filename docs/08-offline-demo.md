# The offline demo

One HTML file that runs the whole app on a laptop with **no internet, no account and no server**. For showing the app
to a client.

## Make it

```
pnpm demo:build
```

This writes `demo/PT-Planner-Demo.html` (about 1.4 MB). Rebuild it whenever the app changes. Copy the file to a USB
stick or email it: it is self-contained.

## Open it

Double-click the file (Chrome, Edge or Firefox). You are signed in as a demo trainer with the Virgin Active
Bedfordview plan and the exercise library already loaded. If you ever see the sign-in screen, any email and password
work.

- Everything is saved in that browser on that computer (local storage), so a reload keeps your changes.
- **Reset demo** (bottom-left pill) wipes all changes and starts fresh. Press it before each client demo.
- A client link opens in another tab of the same browser. It looks like `file:///…/PT-Planner-Demo.html#/p/<long code>`:
  open it in a second tab to show the client's view (no sign-in, no private data). It will not open on another
  computer: the demo's data lives in this one browser.
- Use the same browser for the whole demo. Chrome and Edge keep local storage for files opened from disk; if a browser
  blocks it the demo still works, but changes are lost on reload.
- Fonts come from Google when the computer is online; offline the app uses plain system fonts. Nothing else is fetched.

## What works, and what is pretend

Everything in the app works as in the real thing: plan, session builder, templates, run mode with rest timers,
history, clients and consent, programmes, PDF, share links, the layout editor, gyms, and the equipment catalogue.
The "database" is a built-in stand-in, so:

- nothing is sent anywhere, and nothing is shared between computers;
- WhatsApp and email buttons open the real apps if the computer has them (they need internet there);
- the privacy wording is still the draft awaiting attorney review.

Library and Data tabs are not built yet (they say so on screen).

## A 10-minute demo script

1. **Plan** (Plan session): tap a machine, the pop-up lists exercises that suit it. Use the muscle focus chips. Switch
   floors.
2. **Build a session**: add 4 or 5 exercises from different machines. Session tab: edit sets and reps, reorder, see the
   route on the plan. Save it as a template.
3. **Run it**: Run tab, Start workout. Show the rest countdown, tap machines to jump, finish, then Past runs and the
   results PDF.
4. **Clients**: Your business details, Add client, the consent screens (health data stays locked until consent),
   assign the session to the client, Share, Create a link, open it in a second tab. Show the PDF button there.
5. **Edit layout**: drag a zone, resize with the grips, add a machine, add a wall or stairs, join two zones. Save.
6. **Catalogue**: add a manufacturer and a model with specifications, tag a machine with it in Edit layout, then show
   the model in the machine pop-up and the session.
7. **Gyms**: add a second gym as a copy of this one, switch between them, and show the routine moving across.

Press **Reset demo** afterwards.
