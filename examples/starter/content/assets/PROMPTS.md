# 生成提示词

工具：Codex 内置 `image_gen`。本文件保留原素材来源，并在末尾记录 2026-09-23 批准样图后的更新。下面的原港口和原三张立绘已被替换；室内、灯塔与旧头像仍沿用。原版曾按当时授权做本地透明底处理，**该历史处理不适用于本次新图**。

## harbor.png

Use case: illustration-story. Asset type: production background art for an original Chinese narrative game starter, a short coastal mystery called 雾港来信. Generate ONE finished, cinematic 16:9 landscape illustration, preferably 2048x1152. Scene: a small rain-washed northern coastal harbor at blue hour before dawn, a stone ferry pier in the foreground, a modest old postal station with a single warm window along the right edge, weathered blue wooden railings, the quiet sea in the middle distance, and a distant lighthouse cutting one thin beam through layered sea mist. A few empty mooring ropes and wet stone reflections make this an inhabited place, without any people. Modern premium visual-novel background painting: confident hand-painted shapes, convincing perspective, fine atmospheric depth, soft natural light, grounded and slightly wistful, restrained editorial anime background craft rather than simplified vector art. Palette: slate sea blue, blue-gray mist, muted teal, with small warm brass-colored lights. Clear focal hierarchy and a broad quiet central area suitable for the game's live title and menu overlay. Keep detailed contrast in the side architecture and lighthouse, central water/sky relatively calm; bottom quarter can take a dialogue panel. Full-bleed image, no border, no panels, no words, no lettering, no UI, no logo, no watermark. This is final usable game artwork, not a website mockup.

## post_office.png

Use case: illustration-story. Asset type: final production background for the original coastal narrative game 雾港来信. Create ONE full-bleed 16:9 image, preferably 2048x1152. An old but carefully kept small postal station beside a northern coastal harbor just before dawn. View from inside toward a tall rain-streaked window and the sea; dark teal painted wood, weathered sorting shelves with neatly tied plain letters, a worn oak counter with one cream envelope and a brass lamp, muted blue-gray daylight mixing with a very small pool of amber lamplight. No people. A modest working room full of tactile materials and quiet memory, not a magical library or grand palace. Premium cinematic hand-painted game background with realistic proportions, sophisticated light, detailed atmospheric brushwork, grounded and restrained. Match a slate-blue harbor, mist, wet stone and warm brass light aesthetic. The center should remain legible and spacious for a foreground character; a dialogue panel may cover the bottom quarter. No readable writing, no decorative lettering, no UI, no panels, no border, no watermarks. Final usable artwork, not a mockup.

## lighthouse_dawn.png

Use case: illustration-story. Asset type: final ending background artwork for the original visual novel 雾港来信. One cinematic full-bleed 16:9 landscape, preferably 2048x1152. The stone terrace of a modest white coastal lighthouse above a northern harbor at the first light of dawn. The rain has just stopped; wet gray flagstones and a low weathered stone wall in the foreground, the lighthouse occupies the left third, mist opens over the calm slate-blue sea and a small distant fishing town on the right. Early pale gold sunlight catches the lighthouse door and railings; a narrow open view toward the horizon suggests a quiet new beginning. No people. Restrained, premium realistic hand-painted game background, sophisticated atmospheric perspective, subtle blue-gray/teal and muted brass palette, natural material detail and soft cinematic light. Coherent with a misty harbor and old wooden postal station. Main middle/right portion has room for a character; the lower quarter can sit behind dialogue. Not fantasy spectacle, no giant sun, no magical effects. No words, no lettering, no UI, no borders, no watermark, no panels.

## lynn_coat_normal.png

参照图：`examples/zero-after-midnight/content/assets/portrait/zhirao_commute_calm.png`。参照图保持原样，只作为绘画风格输入。

Edit the PROVIDED 2D visual-novel illustration into another character, 凛, a 25-year-old harbor courier. This reference is the approved drawing style. Preserve its actual illustration language: the fine dark uneven ink contours, its simple almond-shaped anime eyes and tiny mouth/nose marks, matte pale skin, graphic large locks of hair, broad restrained blue-gray clothing shadow shapes, and slight dry-brush finish. It should look as if the SAME illustrator drew a second cast member on the same day. Keep the reference's level of simplification. Do not polish it into a fashion rendering.

Changes to character design: replace the long black hair with a short dark ash-brown bob ending near the jaw, a few loose side bangs, one ear partly visible. Give her a quiet, slightly reserved neutral expression. Replace the navy padded parka with a SIMPLE unpatterned muted blue-gray courier coat, open just enough to show a plain off-white shirt. A plain dark-brown messenger-bag strap crosses the torso. One hand rests loosely in the coat pocket; the other holds a simple sealed cream envelope near the hip. Natural relaxed standing pose with a small asymmetry in the shoulders. Adult proportions. Frame the figure from head to mid-thigh on a portrait 2:3 canvas with clear margin, all of the head and visible hand intact.

Critical style limits: three or four clear values per material, broad simple folds, clean silhouette, sparse confident lines. No marbled/wet fabric pattern, no shiny buckles, no pores, no realistic knit fibers, no tiny speculative wrinkles, no painted glossy lips, no photographic highlights, no sparkling eyes, no ornamental detail. Hair shading should be large graphic shapes rather than hundreds of individually rendered hairs. Follow the face construction and flat quiet shading of the provided reference much more closely than a generic AI anime illustration.

Deliver one isolated character sprite. Preserve a genuinely transparent PNG alpha background like the input; absolutely no checkerboard pixels, black painted background, white painted background, vignette, halo or scene. No text, names, labels, collage, frames or multiple versions.

## 表情变化

两个表情都以最终常态生成图为输入，使用以下共同约束；表情句分别插在首句之后。

Make one expression variant of the EXACT short-haired courier in this input illustration. Keep the face identity, short dark ash-brown bob, gray eyes, head angle, shoulders, entire standing pose, hands, envelope, messenger bag, coat, shirt, trousers, palette, thin ink outlines and broad simple matte shading as in the input. Do not add tiny folds, material texture, realistic skin, shine, makeup or digital gloss. This must remain the same spare two-dimensional visual-novel illustration, not a new interpretation of the character. Keep the same 1024x1536 canvas and the same figure scale and placement so the sprites can be swapped in the game. One single character only. Use a uniform plain white background for later authorized cutout; no checkerboard, shadow, vignette, text, frame or extra elements. Do not crop the head or hand.

### lynn_coat_hesitant.png

Change ONLY her facial expression to quiet hesitation: inner eyebrows slightly raised, gaze a little lowered, lips softly pressed with a very small downward turn. She is gathering the courage to speak about an old letter. Keep the emotion restrained and believable, without tears, blush marks or exaggerated symbols.

### lynn_coat_smile.png

Change ONLY her facial expression to quiet relief: a small warm closed-mouth smile, the eyes soften and the brows relax. She has finally said something she could not say before. Keep the smile subtle, without visible teeth, blush effects, sparkles or exaggerated expressions.

## avatar/lynn.png

头像直接取自常态立绘的头部与肩部区域，没有重新绘制五官。三张立绘均为 1024×1536 RGBA，头像为 610×610 RGBA。

## 透明底处理

生成器将棋盘格或白色背景写进 RGB，不能把预览中的棋盘格当作透明证明。按 Owner 明确授权在本地去掉与画面外侧连通的浅色背景，并补清理发梢和手臂的封闭空隙，仅建立 alpha 通道及边缘抗锯齿。人物 RGB 保持生成图原值；已在深、浅底上检查发梢、手指、信封和外轮廓。运行素材使用真实透明 PNG，生成器的原始候选保留在项目之外。

## 2026-09-23：批准 A4 样图后的运行素材

以 Owner 最后批准的上下双画面样图为输入；上半封面没有人物，下半阅读页保留短发成年邮差。以下为生产素材编辑的核心提示词。背景、字标与正常立绘分别生成，不把样图 UI 烘焙进背景。

### logo

Use case: background-extraction. Extract ONLY the exact approved blue Chinese title logo "雾港来信" from the upper panel of the reference into a production-ready PNG with a genuinely transparent alpha background. Preserve the exact four character letterforms, proportions, dark-blue to cyan coloring, tiny envelope motif integrated above 信, and sweeping wave underline. Do not redesign, retype, simplify or add text. No sky, clouds, sea, background, white rectangle, baked checkerboard, menus or label. The logo should fill the transparent canvas with a small even safety margin. Wide horizontal aspect ratio approximately 2.5:1. Clean anti-aliased edges. This is extraction of approved art, not a new logo concept.

### background

Use case: precise-object-edit. Produce the background layer for the UPPER cover panel of the reference as a single 16:9 landscape game background. Extract the approved sunny blue harbor, lighthouse, wooden pier and right-side post office composition. Remove ALL UI overlays: remove the large "雾港来信" logo and underline, remove the five menu lines on the left, remove the outer option label and white margins. Inpaint only those text regions with their naturally continuous sky/water. No people. Retain the post office sign and environmental chalkboard as part of the scenery. Omit the entire lower panel. Preserve approved art, palette, perspective, camera and shoreline; no redesign, extra houses, new objects or atmospheric changes. The left sky and sea must remain bright and open, suitable for the approved logo/menu as separate overlays. Output one clean full-bleed landscape background, no frames, no captions.

### portrait

Use case: background-extraction / identity-preserve. Extract the APPROVED short-haired adult heroine from the LOWER reading panel of the reference into a production-ready character sprite with genuinely transparent alpha background. Keep EXACTLY her approved face drawing, eyes, black/dark-brown bob haircut, expression, navy coat over white shirt, diagonal strap, pose and raised hand holding the closed envelope. Do not reinterpret her face or style, do not add hair gloss or soft airbrushed skin. Remove scenery and all dialogue/UI overlays. Reconstruct only the clothing/arm areas occluded by the dialogue box, extending the coat naturally to mid-thigh for game sprite placement; avoid inventing accessories. Keep both hands anatomically correct and the face/upper-body proportions from the original. Vertical canvas, head entirely visible with a small top margin, shoulders and arms not cropped. No ground shadow, background, white rectangle, checkerboard or text. Clean transparent edges, no white halo. Output ONE normal-expression sprite, not a sheet.

### 定稿约束与表情变体

字标首版出现了不需要的立体高光，未采用；第二次限定 flat 2D lettering、no bevel、no glossy highlights，保留深蓝四字与青色波浪下划线。常态立绘再次要求清理背景、真实透明 alpha、保持脸部与服装，不增加场景、阴影、光晕或厚涂。

犹豫与微笑均以最终常态立绘为输入，只改表情，保留 1024×1536 画布、人物位置、服装、信封和线条：犹豫为内眉微提、视线略低、抿嘴；微笑为轻微闭口释然、眉眼放松。共同要求 same face identity, exact pose and canvas, true transparent PNG, no background, no halo, no extra accessories, no text。没有本地抠图、裁切或重画；保留生成器原始输出。
