# Duty Desk · Plus Two High School, Bushenyi

Staff duty rota, term planner, team chat and message alerts. Motto: Combine Efforts.

This is a static website (no build step). Sign-in, data, alerts and password resets run on Supabase.

## Put it online
1. Create a **private** GitHub repository and upload every file in this folder to its root (not inside a sub-folder).
2. In Vercel: Add New Project, import the repository, Framework Preset "Other", then Deploy.

## Files
- `index.html`, `app.js`, `styles.css`, `data.js`: the app.
- `sw.js`, `manifest.json`: installing on the phone, offline shell and message alerts.
- `supabase-config.js`: the Supabase project address and public key. The public key is meant to be in the website. Never put the `service_role` key anywhere in this folder.
- `badge.jpg`, `campus.jpg`, `leadership.jpg`, `log-bg.jpg`, `favicon.ico`: pictures.

## If the website address ever changes
- Supabase, Authentication, Passkeys: set the Relying Party ID and origin to the new address (fingerprint sign-in).
- Staff open the new address, install the app again and turn message alerts on again.
