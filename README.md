# YouTube Thumbnail to Notion (Chrome Extension)

Enter a YouTube URL, preview its title and thumbnail, and add it to your Notion database.

## Install (Developer Mode)

1. Open Chrome → Menu → Extensions → Manage Extensions.
2. Enable Developer mode (top right).
3. Click "Load unpacked" and select this folder.
4. Click the extension icon to open the popup.

## Configure Notion

1. Create a Notion internal integration and copy the token.
2. Share your target database with that integration.
3. Open the extension Options and paste:
   - Notion Internal Integration Token
   - Target Database ID (from the database URL)
4. Ensure the database has a title property named `Name`. Optionally add a URL property named `URL`.

## Usage

1. Paste a YouTube URL in the popup and click Preview.
2. Confirm the title and thumbnail.
3. Click "Add to Notion" to create a page with the thumbnail as cover and an image block.

## Notes

- Video details are fetched via YouTube's oEmbed endpoint (no API key needed).
- The page cover and image block use the thumbnail's external URL.
- Notion API version used: 2022-06-28.




