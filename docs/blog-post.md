I build a lot of small prototypes and pages, and I need people to tell me what's wrong with them. Email doesn't work well for that. "The second paragraph feels off" means I have to work out which paragraph, then what was meant.

If you've used comments in Google Docs, you know the shape. You select some words, say what you think, and the comment stays with those words. Everyone sees the same list, and you resolve each one when it's dealt with.

Notis is that for web pages. It's a small tool called Notis, which is Swedish for a short note. A reviewer selects the words they mean and leaves a comment on them. The comment stays attached to those words, and everyone who opens the page sees the same list.

It's open source and live at [notis.gavinwye.com](https://notis.gavinwye.com), where you can try it. You can also ask an agent to add it to your site: the site has a one-line prompt for that.

## What it does

- Select any text and write a comment.
- Drop a pin on an image to comment on a particular spot.
- A side panel lists every comment in the order it appears on the page, with replies and resolve.
- Clicking a comment in the panel scrolls the page to the words it's about.
- Nobody needs an account. People type a name once and it's remembered.

It's one script on the page and one small function behind it. There's no database to set up.

## How it compares with Google Docs

The part you'd recognise is the same: comments on the words, threads, replies and resolve.

The differences are about where it works.

- It works on a real web page, the one you built, rather than on a document someone has to paste it into.
- Reviewers don't need an account or access to a file. They open the link and type a name.
- Your comments are stored where you choose (your Netlify, Cloudflare or Node server), so you hold the data.
- The comments are data, so a script or an agent can read them and act on them.
- You can pin a comment to a particular spot on an image.

It's much smaller than Google Docs. It's for comments and nothing else: no editing, no suggested changes, and no way to tag a person yet.

## Where it started

I first used it on early service prototypes. A stakeholder could mark up exactly the words they were reacting to, instead of sending notes back later. It has since gone onto a lot of the sites and prototypes I build.

## The part I use most

Comments are plain JSON. When I ask Claude to "fix my comments", it reads the open ones, finds the words each one points at, changes the page, and marks the comment resolved.

That turns review into a short loop. I read the page, leave comments, and come back to a page that has already changed. I still check what it did, because some comments are really questions.

## What it doesn't do

- There's no sign-in. Anyone who can load the page can comment, so put review copies behind a password or a preview URL.
- It doesn't notify anyone. You look at the panel.
- It's for a handful of reviewers. It isn't a comment section for a busy public page.
- Pins work on image tags. They don't work on CSS backgrounds or inline SVG.

## Try it

It's MIT licensed. The setup is in the README, and you can add it to a page with one line.

- Site: https://notis.gavinwye.com
- Source: https://github.com/gavinwye/notis.gavinwye.com
