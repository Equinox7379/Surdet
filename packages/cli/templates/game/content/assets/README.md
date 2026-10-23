# 默认素材库

本目录提供凛的五套服装、配套背景和游戏UI皮肤。凛是22岁的原创成年角色。2026-10-18起以Owner选定的B脸完整立绘为定稿：清冷猫形蓝灰眼、栗色短发和浅蓝发结，后续表情/换装不再重新设计脸；不再使用教程原来的几何占位人物。

**当前人物状态：** 外套六表情、泳衣三表情与旗袍/睡衣/夏装共12张已统一至Owner选定的B脸。基础外套normal获明确认可，其余为同脸派生、未获逐图审美确认。Owner随后指出头发仍有AI感，正在单独重画头发候选；未确认前不将新发型铺满整套。

## 使用

```gal
@bg harbor
@show rin:coat normal @ right
凛：你好。
@show rin:coat smile @ right
凛：船还没有靠岸呢。
@hide rin:coat
@show rin:qipao normal @ right
凛：今晚来竹影楼坐坐？
```

角色表已登记`rin`。外套有`normal / smile / hesitant / serious / surprised / sad`六种表情，泳衣有`normal / smile / hesitant`，旗袍、睡衣、夏日便服目前各有`normal`；没有的表情不应猜测引用。同一服装切换表情可直接再次`@show`；换服装时先用`@hide rin:coat`这类完整标识隐藏上一套，再显示新服装，避免不同舞台对象重叠。模板的`theme.dialogSkin`和`theme.buttonSkin`分别使用`ui_dialog`、`ui_button`，文字和按钮名称由引擎绘制，不烘焙在图片里。

| 文件 | 用途 |
| --- | --- |
| [portrait/rin_coat_normal.png](portrait/rin_coat_normal.png) | 凛·外套·平静 |
| [portrait/rin_coat_smile.png](portrait/rin_coat_smile.png) | 凛·外套·微笑 |
| [portrait/rin_coat_hesitant.png](portrait/rin_coat_hesitant.png) | 凛·外套·害羞／迟疑 |
| [portrait/rin_coat_serious.png](portrait/rin_coat_serious.png) | 凛·外套·认真 |
| [portrait/rin_coat_surprised.png](portrait/rin_coat_surprised.png) | 凛·外套·惊讶 |
| [portrait/rin_coat_sad.png](portrait/rin_coat_sad.png) | 凛·外套·低落 |
| [portrait/rin_swim_normal.png](portrait/rin_swim_normal.png) | 凛·泳衣·平静 |
| [portrait/rin_swim_smile.png](portrait/rin_swim_smile.png) | 凛·泳衣·微笑 |
| [portrait/rin_swim_hesitant.png](portrait/rin_swim_hesitant.png) | 凛·泳衣·迟疑 |
| [portrait/rin_qipao_normal.png](portrait/rin_qipao_normal.png) | 凛·旗袍 |
| [portrait/rin_pajamas_normal.png](portrait/rin_pajamas_normal.png) | 凛·睡衣 |
| [portrait/rin_summer_normal.png](portrait/rin_summer_normal.png) | 凛·夏日便服 |
| [bg/station_night.png](bg/station_night.png) | 雨夜车站 |
| [bg/platform_dawn.png](bg/platform_dawn.png) | 清晨站台 |
| [bg/beach_day.png](bg/beach_day.png) | 海滩日景 |
| [bg/beach_evening.png](bg/beach_evening.png) | 海滩夕景 |
| [bg/harbor.png](bg/harbor.png) | 港口晨景（Owner已认可） |
| [bg/harbor_evening.png](bg/harbor_evening.png) | 同机位港口傍晚（新差分待确认） |
| [bg/harbor_rain.png](bg/harbor_rain.png) | 同机位港口雨天（新差分待确认） |
| [bg/post_office.png](bg/post_office.png) | 邮局室内（重绘候选） |
| [bg/lighthouse_dawn.png](bg/lighthouse_dawn.png) | 灯塔清晨（重绘候选） |
| [bg/ui_dialog.png](bg/ui_dialog.png) | 对话框皮肤 |
| [bg/ui_button.png](bg/ui_button.png) | 菜单按钮皮肤 |

## 来源和当前状态

港口新增同景差分`harbor_evening`、`harbor_rain`，剧本中可分别用`@bg harbor_evening`、`@bg harbor_rain`引用。它们是可选资源，尚未改动默认开场引用；已确认的`harbor.png`晨景保留。新差分已作图片层面的构图检查，未获Owner逐图审美确认，也未用实际Player运行验证本轮新图。

2026-10-16至18通过Codex内置`image_gen`生成，PNG原始输出直接复制入库。立绘保留生成器提供的透明通道；没有使用本地抠图、滤镜或程序绘制人物。风格参考清爽的现代日式视觉小说，不包含商业游戏的原始美术，不宣称人工手绘或独占版权；字体及其他第三方许可仍分别适用。

Owner于2026-10-18明确认可B脸的完整外套立绘，外套`normal`已直接使用该输出。其余11张由定稿作表情编辑或同脸换装，不把基础立绘认可扩大成Owner对全部派生图的逐图认可；旧脸已从本套12张活动图中替换，旧版人物设计描述不再作为后续设计要求。Owner随后要求重画头发，当前仅制作单张候选，脸和身体保持，不提前标为发型通过。港口背景的Owner认可继续有效；邮局与灯塔仍待审美确认。千夏与橘未定稿，不随本目录提供，不得凭历史生成记录猜测引用。已否定背景不作为活动图或备用；本轮替换的旧外套图已移出使用链并保留私有原件，旧受控图片亦可从Git历史恢复。

教程的三张图片及Starter同名背景复用这里的对应资源。Starter原有`lynn`人物和标题字标保持原身份；独立作品及测试用的几何图形夹具不是默认人物素材，不在本次替换范围。

## 当前素材的生成提示

以下保留各实际生成提示（英文便于复用）。图像间引用用于保持人物身份、姿势或背景画法；重新生成不保证像素相同。车站夜景的原始逐字提示未保留，单独标为画法要点，不伪称原始请求。

### 凛·外套·平静 — `portrait/rin_coat_normal.png`

输出原件：`exec-12bc47e6-5812-48c1-bbde-ef8b7677d309.png`。Owner明确认可的B脸完整立绘。实际输入为原外套全身图与B脸稿；后续差分以本图为唯一编辑底图。

```text
Use case: compositing.
Two images, two strict roles:
IMAGE 1 = full-body outfit/pose/composition edit target. Its OLD FACE IS REJECTED.
IMAGE 2 = the EXACT FACE AND HEAD DESIGN selected by the owner. This face is APPROVED. Transfer it faithfully; do not redesign, round off, simplify its eyes, change its expression, or substitute image 1's old face.

Make ONE complete transparent full-body visual-novel sprite of the same adult young woman. Use image 2's specific slim youthful cheek/chin silhouette, distinctive upturned cat-shaped blue-gray eyes, tapered upper lashes, individual iris drawing, eyebrow shapes, tiny neutral closed mouth and cool slightly unimpressed expression. Keep its precise eye-to-nose-to-mouth proportions. Match the drawing in image 2, not the descriptions of any earlier candidates. Do NOT add a smile, sleepy eyes, giant doll irises, an O mouth or a new beauty mark. Use image 2's chestnut bob and inner fringe structure and the pale-blue ribbon, adapting the overall head rotation gently to image 1's natural tilt. This is a faithful face/head transfer, not another attempt to invent the heroine's face.

Preserve IMAGE 1's entire body and ALL outfit details below the head: navy long coat, gold buttons, ivory POINTED-COLLAR blouse, dusty-rose neck bow, charcoal pleated skirt, dark tights, brown loafers, brown shoulder bag, hand holding the shoulder strap, other hand in coat pocket, leg position and stance. Do NOT use the different shirt neckline from image 2. Keep image 1's overall adult body/head proportions and head scale, with a natural neck connection; no enlarged pasted-on head.

Clean polished Japanese 2D visual-novel character art, coherent linework and shading between the head and existing body. Full figure from the complete top of hair to both shoes, original tall 2:3 composition with comfortable margins. The selected face from IMAGE 2 must remain recognizable at full-body scale; retain its intentional eye design.

Genuinely TRANSPARENT alpha background, with no black/colored backdrop, fog, glow, halo, ground shadow, text, watermark, insets or comparison panels. ONE finished full-body sprite only.
```

### 凛·外套·微笑 — `portrait/rin_coat_smile.png`

输出原件：`exec-0fa6ccef-cf63-49fc-b836-9cd7989d8118.png`。表情编辑底图：本轮已认可的rin_coat_normal.png。

```text
Use case: identity-preserve. Image 1 is the OWNER-APPROVED full-body sprite of Rin, an adult22-year-old original VN heroine. This is an EXPRESSION-ONLY edit, NOT a redesign. Keep this exact face identity and cat-shaped blue-gray eyes, their iris/lash design, facial contour, nose, head proportions, chestnut bob and blue ribbon. No new beauty mark or freckles.
LOCK everything outside the small expression area: same1024x1536 portrait composition, head position/tilt/scale, entire body, shoulders, coat with gold buttons, pointed ivory blouse and dusty rose neck bow, pleated skirt, tights, shoulder bag, both hand positions, stance and both loafers. Full figure from hair to shoes. Do not redraw her into another person or change costume/pose. Same clean refined Japanese VN linework and restrained cel shading as the approved source. No realistic facial repaint, extra makeup, glossy round gacha eyes or new accessories.
Genuinely transparent alpha background, no black/colored backdrop, glow, halo, vignette, ground shadow, text, watermark or inset. One full-body sprite only.
Change ONLY the expression to a small sincere, gently warm CLOSED-MOUTH smile: both corners lift softly rather than an adult teasing smirk, cheek expression softens a little, eyes remain open and preserve the exact cool cat-eye silhouette and clear blue-gray irises. One tiny natural smile, no toothy grin, open O mouth, huge eyes, closed crescent eyes or large blush.
```

### 凛·外套·害羞／迟疑 — `portrait/rin_coat_hesitant.png`

输出原件：`exec-f8cab406-4c45-48fd-89e6-b4ffc04a56d0.png`。本轮为害羞/迟疑表情；保留既有hesitant文件名，不新增别名。底图：本轮已认可的rin_coat_normal.png。

```text
Use case: identity-preserve. Image 1 is the OWNER-APPROVED full-body sprite of Rin, an adult22-year-old original VN heroine. This is an EXPRESSION-ONLY edit, NOT a redesign. Keep this exact face identity and cat-shaped blue-gray eyes, their iris/lash design, facial contour, nose, head proportions, chestnut bob and blue ribbon. No new beauty mark or freckles.
LOCK everything outside the small expression area: same1024x1536 portrait composition, head position/tilt/scale, entire body, shoulders, coat with gold buttons, pointed ivory blouse and dusty rose neck bow, pleated skirt, tights, shoulder bag, both hand positions, stance and both loafers. Full figure from hair to shoes. Do not redraw her into another person or change costume/pose. Same clean refined Japanese VN linework and restrained cel shading as the approved source. No realistic facial repaint, extra makeup, glossy round gacha eyes or new accessories.
Genuinely transparent alpha background, no black/colored backdrop, glow, halo, vignette, ground shadow, text, watermark or inset. One full-body sprite only.
Change ONLY the expression to a reserved shy/hesitant look: gaze moves a little down and aside without turning the head, inner brow ends lift just slightly, lips close in a small uncertain near-horizontal line, a restrained subtle blush at the cheeks. She is quietly embarrassed rather than performing a pout. Preserve the exact cat-eye geometry and irises, no watery doll eyes, tears, open mouth, heavy blush cloud or extra symbols.
```

### 凛·外套·认真 — `portrait/rin_coat_serious.png`

输出原件：`exec-a06327f2-0b10-424e-ab95-77011a3a5918.png`。表情编辑底图：本轮已认可的rin_coat_normal.png。

```text
Use case: identity-preserve. Image 1 is the OWNER-APPROVED full-body sprite of Rin, an adult22-year-old original VN heroine. This is an EXPRESSION-ONLY edit, NOT a redesign. Keep this exact face identity and cat-shaped blue-gray eyes, their iris/lash design, facial contour, nose, head proportions, chestnut bob and blue ribbon. No new beauty mark or freckles.
LOCK everything outside the small expression area: same1024x1536 portrait composition, head position/tilt/scale, entire body, shoulders, coat with gold buttons, pointed ivory blouse and dusty rose neck bow, pleated skirt, tights, shoulder bag, both hand positions, stance and both loafers. Full figure from hair to shoes. Do not redraw her into another person or change costume/pose. Same clean refined Japanese VN linework and restrained cel shading as the approved source. No realistic facial repaint, extra makeup, glossy round gacha eyes or new accessories.
Genuinely transparent alpha background, no black/colored backdrop, glow, halo, vignette, ground shadow, text, watermark or inset. One full-body sprite only.
Change ONLY the expression to focused quiet seriousness: gaze directly attentive, brows settle slightly inward and lower, lips form a small firm closed line, relaxed smile is absent. Keep her youthful face and the same cat-shaped eyes, iris/lash drawing and cheek contour. Thoughtful and determined, not scowling, seductive, angry, tired or glaring. No wrinkles, tears, extra blush or sharp new jaw.
```

### 凛·外套·惊讶 — `portrait/rin_coat_surprised.png`

输出原件：`exec-6f58b935-7538-4b5a-81e1-034668bd59df.png`。实际编辑输入：`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: identity-preserve. Image 1 is Rin's OWNER-APPROVED full-body sprite, adult22. EXPRESSION-ONLY edit, not a redesign. Preserve this exact cat-shaped blue-gray eye identity, iris and lash drawing, face contour/proportions, chestnut bob and pale-blue ribbon. No new beauty mark or freckles. LOCK canvas1024x1536, head scale/tilt/position, whole body and ALL outfit details: navy coat and gold buttons, pointed ivory blouse, dusty rose bow, charcoal skirt, dark tights, brown shoulder bag and loafers, hand on strap and other in pocket, leg stance. Full hair-to-shoes sprite with same alignment and margins. Clean refined Japanese VN linework, same restrained cel shading. GENUINE transparent alpha, no black/colored background, glow, fog, halo, shadow, text, inset.
Change ONLY the facial expression to restrained natural surprise: brows lift a little, eyelids open slightly but retain recognizable pointed cat-eye silhouette and irises; lips part into a tiny soft 'oh'. No gag face, huge round eyes, giant mouth, tears or symbols. Still the same young-looking adult heroine.
```

### 凛·外套·低落 — `portrait/rin_coat_sad.png`

输出原件：`exec-ffc64bdb-ed2c-4d40-ae32-abd7117cc3e0.png`。实际编辑输入：`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: identity-preserve. Image 1 is Rin's OWNER-APPROVED full-body sprite, adult22. EXPRESSION-ONLY edit, not a redesign. Preserve this exact cat-shaped blue-gray eye identity, iris and lash drawing, face contour/proportions, chestnut bob and pale-blue ribbon. No new beauty mark or freckles. LOCK canvas1024x1536, head scale/tilt/position, whole body and ALL outfit details: navy coat and gold buttons, pointed ivory blouse, dusty rose bow, charcoal skirt, dark tights, brown shoulder bag and loafers, hand on strap and other in pocket, leg stance. Full hair-to-shoes sprite with same alignment and margins. Clean refined Japanese VN linework, same restrained cel shading. GENUINE transparent alpha, no black/colored background, glow, fog, halo, shadow, text, inset.
Change ONLY the facial expression to quiet sadness held inward: gaze lowers a little, inner brow ends lift subtly, small closed mouth corners lower gently. Keep the precise cat-eye silhouette and distinctive face. No tears, watery huge eyes, exaggerated pout, tired mature face or melodrama.
```

### 凛·泳衣·平静 — `portrait/rin_swim_normal.png`

输出原件：`exec-dc9f949f-caf6-4b1c-84c5-9e5c60197b35.png`。实际编辑输入：`rin_swim_normal.png`、`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: compositing / identity-preserve. Make one complete full-body transparent visual-novel sprite of Rin, the same ADULT 22-year-old original woman. IMAGE 1 is the OUTFIT/BODY/POSE edit target; its OLD FACE is rejected. IMAGE 2 is the OWNER-APPROVED FACE/HEAD reference. Transfer IMAGE 2's exact face identity: cat-shaped blue-gray eyes with its individual iris and tapered lash drawing, specific cheek/chin contour, small neutral closed mouth, chestnut bob and pale-blue ribbon. Match this actual face, do not invent a new face, enlarge round doll eyes, add a mole/freckles, or turn her into a mature smiling model. Adapt head rotation naturally to IMAGE 1 without changing head scale. IMAGE 2 supplies ONLY head/face, never its coat, bag, blouse or pose. LOCK IMAGE 1's complete outfit, body proportions, hands, stance, both feet, canvas framing and alignment below the neck. Keep clean refined Japanese VN linework and restrained cel shading coherent with the approved face. One 1024x1536 tall sprite, complete top of hair to soles with margins. GENUINELY TRANSPARENT alpha outside character, no black/colored background, glow, fog, halo, floor shadow, text, watermark or comparison inset.
Keep IMAGE1's ordinary navy-and-white-trim two-piece beach bikini, small side ties, adult body proportions, bare feet and natural straight standing pose with hands down. Nonsexual beach wardrobe asset; no pinup posing or added accessories. Do not import coat, bag or clothes from IMAGE2. Use IMAGE2's exact neutral face identity at natural head scale; character remains adult22.
```

### 凛·泳衣·微笑 — `portrait/rin_swim_smile.png`

输出原件：`exec-9d730da5-ab1e-42c1-9165-5f0794f19e34.png`。实际编辑输入：`exec-dc9f949f-caf6-4b1c-84c5-9e5c60197b35.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: identity-preserve. Image1 is the newly face-matched full-body sprite of Rin, ADULT22. Expression-only edit. Keep this exact owner-selected face identity and pointed cat-shaped blue-gray eyes, iris/lash details, cheek/chin proportions, chestnut bob and pale-blue ribbon. No mole or freckles. LOCK all below the face and entire framing: navy/white-trim ordinary beach bikini with ties, adult body, natural standing pose, both hands, bare feet, head position/size/tilt,1024x1536 tall canvas and margins. Full hair-to-toes figure. Same clean refined Japanese2D VN linework and restrained cel shading, no glossy repaint. Genuinely transparent alpha, no black/colored backdrop, fog, glow, halo, floor shadow, words or inset. Nonsexual neutral beach wardrobe sprite, not pinup.
Change ONLY expression: a small genuine gently warm closed-mouth smile, corners softly lifted, eyes still open with the same recognizable cat-eye silhouette. Relaxed and pleased rather than coy or seductive. No round enlarged eyes or toothy grin.
```

### 凛·泳衣·迟疑 — `portrait/rin_swim_hesitant.png`

输出原件：`exec-fd2bfb3c-4fec-439a-b8cc-7e2ac311f4bf.png`。实际编辑输入：`exec-dc9f949f-caf6-4b1c-84c5-9e5c60197b35.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: identity-preserve. Edit the provided transparent full-body sprite of the same adult22-year-old woman Rin. This is a standard nonsexual beach-swimwear asset for a visual novel. Change only her facial expression to mild uncertainty: slightly raised inner eyebrows and a small closed neutral mouth, looking toward the viewer. No blush or coy expression. Preserve the approved exact cat-shaped blue-gray eyes, face shape, brown bob, blue ribbon, same adult anatomy, ordinary navy swimsuit, hands-down standing pose, bare feet, framing and1024x1536 canvas. Do not change clothing, pose, body proportions or head scale. Clean2D anime linework consistent with source. Genuine transparent background, no backdrop, glow, shadow, text or additional elements.
```

### 凛·旗袍 — `portrait/rin_qipao_normal.png`

输出原件：`exec-34134527-14fa-4817-92cc-f7eb999d8da2.png`。实际编辑输入：`rin_qipao_normal.png`、`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: compositing / identity-preserve. Make one complete full-body transparent visual-novel sprite of Rin, the same ADULT 22-year-old original woman. IMAGE 1 is the OUTFIT/BODY/POSE edit target; its OLD FACE is rejected. IMAGE 2 is the OWNER-APPROVED FACE/HEAD reference. Transfer IMAGE 2's exact face identity: cat-shaped blue-gray eyes with its individual iris and tapered lash drawing, specific cheek/chin contour, small neutral closed mouth, chestnut bob and pale-blue ribbon. Match this actual face, do not invent a new face, enlarge round doll eyes, add a mole/freckles, or turn her into a mature smiling model. Adapt head rotation naturally to IMAGE 1 without changing head scale. IMAGE 2 supplies ONLY head/face, never its coat, bag, blouse or pose. LOCK IMAGE 1's complete outfit, body proportions, hands, stance, both feet, canvas framing and alignment below the neck. Keep clean refined Japanese VN linework and restrained cel shading coherent with the approved face. One 1024x1536 tall sprite, complete top of hair to soles with margins. GENUINELY TRANSPARENT alpha outside character, no black/colored background, glow, fog, halo, floor shadow, text, watermark or comparison inset.
Keep IMAGE1's jade-teal sleeveless mid-calf qipao with high Mandarin collar, ivory piping and small white plum blossom embroidery; preserve its fabric and slit, ivory low closed-toe heels and existing relaxed hand/leg pose. Preserve all garment coverage. Neutral cool face from IMAGE2, not the old knowing smile.
```

### 凛·睡衣 — `portrait/rin_pajamas_normal.png`

输出原件：`exec-883c9faf-8fbb-459c-b81a-03b772b493c0.png`。实际编辑输入：`rin_pajamas_normal.png`、`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: compositing / identity-preserve. Make one complete full-body transparent visual-novel sprite of Rin, the same ADULT 22-year-old original woman. IMAGE 1 is the OUTFIT/BODY/POSE edit target; its OLD FACE is rejected. IMAGE 2 is the OWNER-APPROVED FACE/HEAD reference. Transfer IMAGE 2's exact face identity: cat-shaped blue-gray eyes with its individual iris and tapered lash drawing, specific cheek/chin contour, small neutral closed mouth, chestnut bob and pale-blue ribbon. Match this actual face, do not invent a new face, enlarge round doll eyes, add a mole/freckles, or turn her into a mature smiling model. Adapt head rotation naturally to IMAGE 1 without changing head scale. IMAGE 2 supplies ONLY head/face, never its coat, bag, blouse or pose. LOCK IMAGE 1's complete outfit, body proportions, hands, stance, both feet, canvas framing and alignment below the neck. Keep clean refined Japanese VN linework and restrained cel shading coherent with the approved face. One 1024x1536 tall sprite, complete top of hair to soles with margins. GENUINELY TRANSPARENT alpha outside character, no black/colored background, glow, fog, halo, floor shadow, text, watermark or comparison inset.
Keep IMAGE1's dusty-rose opaque cotton long-sleeve button pajama shirt and loose full-length trousers, ivory piping, tiny crescent pocket embroidery, cream slippers and one hand brushing hair. Do not replace the pajamas with a blouse or short skirt. Neutral calm face from IMAGE2, no mature smile. Complete modest sleepwear.
```

### 凛·夏日便服 — `portrait/rin_summer_normal.png`

输出原件：`exec-b2ac5e1d-8106-49f1-9471-7f140c6f9a4a.png`。实际编辑输入：`rin_summer_normal.png`、`rin_coat_B_selected_20261018.png`。本轮沿认可B脸统一；泳衣迟疑为无脸红的普通犹豫表情，首次请求未产图的记录保留在私有提示文件。

```text
Use case: compositing / identity-preserve. Make one complete full-body transparent visual-novel sprite of Rin, the same ADULT 22-year-old original woman. IMAGE 1 is the OUTFIT/BODY/POSE edit target; its OLD FACE is rejected. IMAGE 2 is the OWNER-APPROVED FACE/HEAD reference. Transfer IMAGE 2's exact face identity: cat-shaped blue-gray eyes with its individual iris and tapered lash drawing, specific cheek/chin contour, small neutral closed mouth, chestnut bob and pale-blue ribbon. Match this actual face, do not invent a new face, enlarge round doll eyes, add a mole/freckles, or turn her into a mature smiling model. Adapt head rotation naturally to IMAGE 1 without changing head scale. IMAGE 2 supplies ONLY head/face, never its coat, bag, blouse or pose. LOCK IMAGE 1's complete outfit, body proportions, hands, stance, both feet, canvas framing and alignment below the neck. Keep clean refined Japanese VN linework and restrained cel shading coherent with the approved face. One 1024x1536 tall sprite, complete top of hair to soles with margins. GENUINELY TRANSPARENT alpha outside character, no black/colored background, glow, fog, halo, floor shadow, text, watermark or comparison inset.
Keep IMAGE1's ivory cotton midi sundress with pale-blue waist sash/edging, open sky-blue cardigan, tan flat sandals and existing gentle cardigan-holding pose. No coat/bag/tights from IMAGE2. Exact neutral cool face identity from IMAGE2.
```

### 雨夜车站 — `bg/station_night.png`

输出原件：`exec-22e83181-79ea-4f9a-a0c9-68d019cd05c7.png`。

画法要点（不是逐字原始提示）：无人雨夜海边小站，等待室与站台形成明确空间；细致但克制的建筑线条、简化湿地反光、薄层动画背景上色，不采用照片滤镜、厚涂或几何占位图。

### 清晨站台 — `bg/platform_dawn.png`

输出原件：`exec-f2e2b593-4e9c-44e8-ba96-67b92875eb5d.png`。

```text
Use case: lighting-weather. Edit the given Japanese anime background into its exact matching dawn version. LOCK the camera, platform, bench, wooden waiting room, every post, track curve, houses and tree silhouettes. Only change weather and light: gentle rain has ended, pale blue sky with warm peach clouds, soft clean morning sunlight, lamps off. The ground is mostly matte with a few broad subtle damp colour patches. Keep the existing hand-drawn thin contours, simplified architectural shapes and controlled anime background colours, two or three shadow values per surface. No photographic textures, no bright mirror reflections, no tiny gravel or foliage detail, no bloom or filter. No people, signs, words, interface or frame. Same wide 16:9 aspect and full-bleed composition.
```

### 海滩日景 — `bg/beach_day.png`

输出原件：`exec-bd7205ed-816f-4290-b8da-0cbd6d422eb9.png`。

```text
Use case: illustration-story. Production Japanese romance visual-novel background, wide 16:9. A quiet small-town Japanese beach in late summer, eye level from the sand. On the LEFT edge a small simple timber changing cabin and two folded beach umbrellas; a modest curving headland with three white houses farther away. RIGHT and middle open clean turquoise sea, shallow flat wave shapes and pale sky with a few graphically drawn white clouds. Gentle curve of shore, foreground calm pale sand with only a few broad simple colour marks. No people. Leave the middle third uncluttered for a standing character. Drawing language: DELIBERATELY SIMPLIFIED HAND-DRAWN ANIME background, visible fine coloured contour lines, large clean flat colour fields, hard-edged cel-shadows, restrained simple atmospheric gradient only in sky. Like an authored TV-animation background layout with Japanese commercial visual-novel refinement. Clear readable shapes, tasteful summer palette, no realistic water, glitter, tiny foliage, phototextures, dramatic god rays, depth-of-field, oil painting, airbrushed realism, 3D, over-detail or glossy floor. No text, interface, watermark or border.
```

### 海滩夕景 — `bg/beach_evening.png`

输出原件：`exec-b58a3997-ed83-4ab8-acda-fea2697ff658.png`。

```text
Use case: lighting-weather. Edit this beach background to its exact matching peaceful late-summer sunset. KEEP the same camera, coast curve, left wooden cabin and two folded umbrellas, distant three houses and all object placements. Only change light/weather: soft pale apricot sky fading to violet above, muted peach sun low on far right horizon, turquoise sea becomes quiet lavender-blue with a few broad pale highlights, long simple cool shadows on sand. No shiny trail of thousands of sparkles.  Wide full-bleed 16:9 production Japanese romantic visual-novel background. Authored 2D anime layout: visible fine coloured line drawing, simplified materials, coherent large colour fields and two or three carefully placed cel-shadow values. Restrained sky atmosphere only. Objects clean and readable, deliberate human scale and perspective, quiet uncluttered middle foreground for a character sprite. No people or readable text, no interface/frame/watermark. Avoid phototextures, photobashing, 3D, thick painting, tiny random details, foliage noise, cinematic grade, bloom and glossy mirror-like surfaces.
```

### 港口晨景（Owner已认可） — `bg/harbor.png`

输出原件：`exec-6da257a2-df0d-4543-ada3-2148bfed7998.png`。

```text
Use case: illustration-story. Asset type: original 2D Japanese romance visual novel background, no characters. Create one fresh wide 16:9 image of a small Japanese fishing-town ferry landing, viewed at ordinary pedestrian eye level. This is a deliberately drawn game background, not a photographic landscape or painted photograph. Composition: a modest post-office corner occupies the left quarter, cream plaster and dark brown timber eaves, one red postbox and a simple bench; a broad quiet pale concrete quay leads through the centre toward a low breakwater; on the right, calm blue-green water and ONE small white working boat. A low headland and a handful of distant rooftops, not a hillside packed with houses. Clear coherent perspective and understandable boat construction. The main centre-right area stays calm so a character sprite can stand there. Medium-sized colour shapes, carefully drafted fine contours at structural edges, restrained smooth painted fills and selective soft gradients for depth. Modern polished Japanese bishoujo visual-novel background drawing, clean everyday summer atmosphere. Greenery is secondary: a few individually shaped masses in muted leaf greens, with only a few purposeful leaf accents; draw depth with overlap and value, NOT a carpet of flecks. Sun is high but lightly diffused, one consistent direction of soft blue-grey cast shadows. Pale cool sky, warm cream walls, subdued blue water, restrained saturation, airy without whitening the whole scene. Keep most walls and pavement smooth; at most a few quiet wear marks near steps. No pervasive peeling paint, rust, grunge, dappled light texture, repeated small brush dabs, individual grass glitter, cinematic sun rays, lens flare, HDR, bloom, oil painting, concept-art matte painting, watercolor texture, photoreal material noise, 3D render, flat vector poster or sticker-like foliage. No text, signage lettering, watermark, interface or people. Strong visual hierarchy, not uniformly detailed.
```

### 港口·傍晚（收敛光色） — `bg/harbor_evening.png`

输出原件：`exec-2215bd65-96b9-497a-857e-6378966187a8.png`。编辑输入为首版`exec-e1bfb160-b45f-44c7-a779-bf155a2e856f.png`与Owner认可的`harbor.png`；首版未作为本轮最终图接入。两版保持同地点机位，新差分尚未获Owner审美认可。

```text
Use case: lighting-weather. Image1 is the SAME-LOCATION EVENING EDIT TARGET; image2 is the OWNER-APPROVED daytime original and the standard for clean restrained drawing. Keep image1's exact camera and every object/perspective/framing unchanged. Correct only the overly theatrical evening light and noisy sky/water/ground. Make it a QUIET EARLY EVENING, not peak golden sunset: substantially reduce orange saturation on facade and pavement; the plaster remains cream, cool grey concrete remains neutral with only gently warm edges. Light is softly warm, shadows subdued blue-violet; open readable foreground. Sky is pale peach near horizon and soft desaturated lavender-blue above, only three or four coherent softly shaped cloud masses and small gaps of clear sky, NOT dozens of repeated glowing flecks. Water stays mainly muted slate-blue with a few selected subdued reflections; remove the bright continuous gold streaks and excess sparkle. Ground uses the original image2's quiet broad surface values, not a layer of directional scratch texture. Preserve details of building, windows, postbox, bench, bollards, ropes, one white boat, breakwater/beacon and distant landscape exactly. Same understated fine painted2D Japanese VN finish as image2, neither vector blocks nor photoreal texture. No lens effects, bloom, rays, extra objects, people, words, watermark or border. Same full-bleed16:9 image.
```

### 港口·雨天（收敛反光） — `bg/harbor_rain.png`

输出原件：`exec-ed0db601-d71d-4f76-8aaf-e0a275bc8a9d.png`。编辑输入为首版`exec-6764d610-ba78-4617-858b-3069a54bc795.png`与Owner认可的`harbor.png`；首版未作为本轮最终图接入。两版保持同地点机位，新差分尚未获Owner审美认可。

```text
Use case: precise-object-edit / lighting-weather. Image1 is the RAINY HARBOUR EDIT TARGET. Image2 is its OWNER-APPROVED dry original, the guide for restrained surfaces and clean thin-painted2D VN drawing. Keep image1's exact architecture, postbox, bench, quay seams, bollards, ropes, boat, breakwater, skyline, camera and framing. Change only the excessive rain/wet-ground rendering: remove the large bright mirror-like puddles/reflections, including the reflected window and postbox images in foreground. The concrete is now mostly MATTE darkened damp concrete, readable broad cool grey colour shapes with selective quiet variations like image2, NOT a reflective lake. At most a few SMALL shallow dark puddle shapes along seams, each with minimal blurred grey reflection. Remove shiny white highlights and stippled rain-ring/crosshatch surface noise. Under soft uniform overcast daylight, simplify sky into a few broad soft grey-blue cloud groups; no repeating tiny cloud chunks. Weather remains light coastal rain, indicated by only sparse subtle fine strokes against sky/water, NOT hundreds of foreground streaks, haze, fog or a curtain. Calm muted sea with few soft broad ripples, not glitter. Building wall remains cream/neutral, red postbox visible. Preserve exact same-location composition and physical detail, keep source's clear quiet romance-VN appearance. No new objects/people/umbrellas, text, watermark, border, photoreal noise, oil painting, vector flattening or cinematic filter. Full-bleed16:9.
```

### 邮局室内（按认可港口重绘） — `bg/post_office.png`

输出原件：`exec-c651674d-5f39-45d7-b2f2-009815bb805b.png`。画法参照：Owner认可的港口输出exec-6da257a2-df0d-4543-ada3-2148bfed7998.png。

```text
Use case: illustration-story. Image 1 is the OWNER-APPROVED drawing and colour reference. Create a NEW original visual-novel background: the INTERIOR of the little waterside post office seen at the left of that picture. Match that image's clean, airy Japanese 2D game-background finish, restrained material detail, readable architectural construction, summer blue light and natural spaciousness. Eye-level wide16:9 interior, a modest wooden service counter across the left foreground, a tidy wall-mounted sorting cabinet behind it, a closed timber door near centre-left, and one open clear patch of floor through the centre-right for character sprites. A large window on the right shows a sliver of the SAME blue harbour, white boat and summer sky, with a short simple cream curtain. Cream plaster walls and dark timber framing match the approved exterior; counter is warm brown, storage metal muted grey-green. Only a few intentional everyday details: one small brass counter bell, two neat letter bundles, a shallow tray, a modest desk lamp. Room is well maintained and quietly used, not an antique shop or neglected archive. Broad soft daylight on the floor, cool shadows, fine structural contours; smooth surfaces with very selective wear at handles, no repeated flecked brushwork, grunge, all-over scuffs or busy paper clutter. This should look like a cared-for place in a romance visual novel, not cinematic concept art, a cafe showroom, a flat vector diagram, a hyperreal photo or a uniformly textured painted photograph. No people, letters, signage text, logo, watermark or UI. Preserve the reference's actual visual finish rather than adding a generic anime filter.
```

### 灯塔清晨（按认可港口重绘） — `bg/lighthouse_dawn.png`

输出原件：`exec-326e2deb-a94b-4185-aeee-54a02468920f.png`。画法参照：Owner认可的港口输出exec-6da257a2-df0d-4543-ada3-2148bfed7998.png。

```text
Use case: illustration-story. Image1 is the OWNER-APPROVED background-style reference. Create a NEW original 16:9 Japanese visual-novel background in the same clean, spacious and naturally lit visual finish: a modest white coastal lighthouse on a low rocky headland at early dawn, reached by a narrow concrete footpath. The little cylindrical lighthouse stands on the left third with one small door and a simple metal lantern balcony; right side opens onto calm blue sea with the familiar low wooded coastline in the distance. One practical plain handrail follows the path. Low coastal grass, a few broad rock shapes, no overgrown flower meadow. Keep a broad quiet central walking area suitable for character sprites. Gentle pale-gold sunlight near the horizon, pale blue sky with TWO or THREE softly drawn cloud groups, muted blue-violet shadows. Match the approved picture's clear perspective, smooth cream-and-white architecture, selective fine contours, airy spatial depth, natural colours and restrained surface detail. Do not make the tower covered in mottled stains or rust. Sea should be calm broad colour planes with a few selected reflected streaks, not hundreds of glittering waves. Ground has only a few seams, grass in coherent masses with limited accents. Do not cover the sky in repeated brush flecks. No dramatic sunset spectacle, fog filter, bloom, lens flare, HDR, impasto, grunge or conceptual matte-painting texture. No people, text, interface, watermark. Reference is style and coastal world only, not an instruction to retain its post office or boat composition.
```

### 对话框皮肤 — `bg/ui_dialog.png`

输出原件：`exec-a7673ef9-74d9-42f8-a31f-5e6f7d518900.png`。

```text
Use case: stylized-concept. Actual flat 2D dialogue-window background texture for an original refined Japanese romance visual novel. A SINGLE filled horizontal panel, aspect3:1, landscape1536x512. The panel surface fills ENTIRE CANVAS from x0 to edge and y0 to edge, no surrounding empty padding or frame on another background. Perfectly flat orthographic graphic design. Warm pale ivory central reading field (#f1eddd), sea-glass green (#b3d2c6) along the left and right narrow edges, refined inky teal thin top and bottom hairline. Only in the outermost6 percent at each end: a tiny very simple original lily-of-the-valley line motif in muted teal and a small dusty rose ribbon accent. Centre88 percent empty and uniform for dark navy text. Extremely restrained flat-colour Japanese illustrated stationery design, clean fine contours, no thick painting, no marbling, no scratchy texture, no flower bouquets, no gold baroque corners, no 3D bevel, no shine or drop shadow. Panel corners can be clipped by only a few pixels; transparent alpha there only, no other transparent holes. No text, nameplate, controls, icons, characters, screenshot, scene or watermark.
```

### 菜单按钮皮肤 — `bg/ui_button.png`

输出原件：`exec-8f9e4186-d0a6-41a2-aec7-10e442dd576e.png`。

```text
Use case: precise-object-edit. This is a flat visual-novel button texture. FILL THE ENTIRE CURRENT TRANSPARENT CENTRAL HOLE with completely solid, uniform pale sea-glass green #c2dcd2. Every single pixel of the complete rectangular image must be opaque, including the centre and all four corners. No transparent areas anywhere. Preserve the fine teal border, left pink ribbon-tab and sparse right ivory leaf motifs. Keep a simple flat-colour middle80 percent as the actual button face, with no texture or shaded frame. Full-bleed rectangle, same3:1 composition. No text. Output on an opaque flat background, not a cutout.
```
