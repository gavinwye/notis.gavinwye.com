# Security

If you find a security problem in Notis, please don't open a public issue. Use GitHub's private vulnerability reporting: the **Report a vulnerability** button on the repository's Security tab.

Things worth knowing about how Notis is meant to be used:

- There is no sign-in. Anyone who can load a page can comment on it. Put review copies behind a password or a preview URL.
- `COMMENTS_ADMIN_TOKEN` guards deleting. Keep it out of the repository and out of logs.
- Set `COMMENTS_ALLOWED_ORIGINS` to your site, so browsers on other sites can't post to your API. CORS is browser policy, not authentication: non-browser clients can omit or forge `Origin`.
- Keep the default write ceilings or lower them, and configure rate limiting at Netlify, Cloudflare, or your Node reverse proxy. Protect the API route with host authentication when comments must not be public.

I'll aim to reply within a week.
