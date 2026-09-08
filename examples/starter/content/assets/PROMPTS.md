# 生成提示词

工具：Codex 内置 `image_gen`。以下记录进入项目的三幅背景与三种立绘的生成提示词。Owner 随后明确允许本地抠图：人物图仅创建透明通道并清除背景，人物 RGB 像素保持；头像从同一常态图截取。最终共有七张运行图片。

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
