I build a lot of small prototypes and pages, and I need people to tell me what's wrong with them. Email doesn't work well for that. "The second paragraph feels off" means I have to work out which paragraph, then what was meant.

So I made a small widget. A reviewer selects the words they mean and leaves a comment on them. The comment stays attached to those words, and everyone who opens the page sees the same list.

## What it does

- Select any text and write a comment.
- A side panel lists every thread, with replies and resolve.
- Comments find their words again when the page loads, and survive small edits to the page.
- Nobody needs an account. People type a name.

It's one script on the page and one small function behind it. There's no database to set up.

## Where it started

I first used it on early government service prototypes in Barbados. A stakeholder could mark up exactly the words they were reacting to, instead of sending notes back later. Nothing in it is specific to government, and it has since gone onto a lot of the sites and prototypes I build.

## The part I use most

Comments are plain JSON. When I ask Claude to "fix my comments", it reads the open ones, finds the words each one points at, changes the page, and marks the comment resolved.

That turns review into a short loop. I read the page, leave comments, and come back to a page that has already changed. I still check what it did, because some comments are really questions.

## What it doesn't do

- There's no sign-in. Anyone who can load the page can comment, so put review copies behind a password or a preview URL.
- It doesn't notify anyone. You look at the panel.
- It's for a handful of reviewers. It isn't a comment section for a busy public page.

## Try it

It's open source and MIT licensed. You can try it on the site, and the setup is in the README.

- Site: https://comments.gavinwye.com
- Source: https://github.com/gavinwye/comments.gavinwye.com
