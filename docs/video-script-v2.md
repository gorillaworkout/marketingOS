# Video Script v2

Status: built on `main` after Social Post v2 (`f3cface`). No new menu item. Access stays the existing `video-script` department grant.

## Video format

The brief requires one format. It is sent with both the preview and the full script, and it changes the script structure:

| Format | Structure |
|---|---|
| Talking Head | To-camera lines plus cutaways |
| B-Roll / Cinematic | Shot list with voiceover and music cues |
| Interview / Podcast | Host and guest question and answer |
| Street Interview | Vox-pop questions and the expected answer type |
| Motion Graphic / Explainer | Scene-by-scene on-screen text and voiceover |
| Event Recap / Documentation | Timeline of moments plus a shot list |

Social Post **Open in Video Script** still fills the topic, hook, shots, platform, and audience. The format is chosen from that handoff: a shot list becomes B-Roll / Cinematic, and words such as podcast, explainer, or event recap select the matching format. Anything else stays Talking Head.

## Storyboard

**Generate storyboard** asks the video-script model to split the finished script into at most 8 scenes (scene number, shot, on-screen text, voiceover, duration). If that call fails, the script's timestamp blocks are used instead.

Each scene image goes through the existing `/api/generate-image` job, including provider failover and the Dupoin image prompt locks. Reels, TikTok, and Shorts use 9:16. YouTube uses 16:9. A failed frame stores its error and can be regenerated on its own. The other frames are kept.

The storyboard is saved on the existing video-script task, in `tasks.output_data.storyboard`. There is no migration 054. Old scripts without a storyboard still open.

Downloads:

- `GET /api/video-script/storyboard?taskId=&kind=zip` — scene images plus a text sheet
- `GET /api/video-script/storyboard?taskId=&kind=pdf` — one page per scene

Screenshots in the PDF are read from `public/outputs/images`. A missing file is noted in the page instead of failing the download.
