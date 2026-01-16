# Universal Expression Board Prompt Templates

These templates use placeholder variables that can be replaced with any character's details. Simply replace the `{{VARIABLE}}` placeholders with your subject's specific attributes.

---

## PLACEHOLDER VARIABLES

```
{{HAIR_COLOR}}        - e.g., "light brown dirty blonde", "jet black", "fiery red"
{{HAIR_STYLE}}        - e.g., "medium-long straight hair past shoulders", "short curly bob", "wavy shoulder-length"
{{EYE_COLOR}}         - e.g., "green-hazel", "deep brown", "bright blue"
{{SKIN_TONE}}         - e.g., "fair skin with light tan and some freckles", "warm olive complexion", "deep brown skin with smooth texture"
{{FACE_SHAPE}}        - e.g., "oval face with defined cheekbones", "round face with soft features", "angular face with strong jawline"
{{DISTINGUISHING}}    - e.g., "natural eyebrows, small straight nose, full natural pink lips", "thick brows, aquiline nose, thin lips"
{{GENDER}}            - e.g., "woman", "man", "person"
{{AGE_DESC}}          - e.g., "young", "middle-aged", "elderly"
{{STYLE}}             - e.g., "Natural iPhone photo aesthetic", "Professional studio portrait", "Cinematic film still"
{{BACKGROUND}}        - e.g., "indoor background", "outdoor park setting", "neutral gray backdrop"
{{LIGHTING}}          - e.g., "natural lighting", "soft studio lighting", "golden hour sunlight"
{{REFERENCE_PATH}}    - Path to your reference image
{{OUTPUT_PATH}}       - Path where generated image will be saved
```

---

## BASE TEMPLATE STRUCTURE

```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. {{EXPRESSION_DESCRIPTION}}. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

---

## EMOTION BOARD TEMPLATES (8 Expressions)

### 1. Happy
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_01_happy.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. HAPPY expression with bright genuine smile, eyes crinkled with joy, teeth showing, radiating warmth and happiness. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 2. Sad
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_02_sad.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SAD expression with downturned mouth, slightly furrowed brow, melancholy eyes, subtle pout, conveying sorrow and dejection. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 3. Angry
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_03_angry.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. ANGRY expression with furrowed brows, intense glare, tightened jaw, lips pressed together firmly, showing frustration and rage. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 4. Surprised
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_04_surprised.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SURPRISED expression with raised eyebrows, wide open eyes, slightly open mouth showing shock and amazement, caught off guard. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 5. Fearful
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_05_fearful.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. FEARFUL expression with wide eyes showing whites, raised inner eyebrows, tense face, slightly parted lips showing anxiety and fear, vulnerable and alarmed. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 6. Disgusted
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_06_disgusted.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. DISGUSTED expression with wrinkled nose, raised upper lip, squinted eyes, showing revulsion and distaste, recoiling from something unpleasant. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 7. Neutral
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_07_neutral.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. NEUTRAL expression with relaxed face, calm demeanor, no particular emotion, resting face, composed and balanced. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 8. Contempt
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/emotion_08_contempt.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. CONTEMPT expression with one-sided smirk, raised corner of mouth, slightly narrowed eyes, showing disdain and superiority, dismissive attitude. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

---

## PLAYFUL BOARD TEMPLATES (8 Expressions)

### 1. Winking
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_01_winking.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. WINKING expression with one eye closed in a playful wink, slight smile, flirty and fun demeanor, charming and lighthearted. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 2. Smirking
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_02_smirking.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SMIRKING expression with asymmetrical smile, one corner of mouth raised, knowing look, mischievous vibe, self-assured attitude. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 3. Tongue Out
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_03_tongue_out.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. TONGUE OUT expression with tongue sticking out playfully, silly and fun mood, eyes bright with amusement, carefree and goofy. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 4. Blowing Kiss
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_04_blowing_kiss.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. BLOWING KISS expression with lips puckered, hand near face blowing a kiss, sweet and affectionate mood, romantic gesture. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 5. Giggling
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_05_giggling.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. GIGGLING expression with mouth open in laughter, eyes squinted with joy, hand possibly covering mouth, infectious happiness, bubbly energy. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 6. Teasing
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_06_teasing.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. TEASING expression with playful raised eyebrow, slight smirk, eyes sparkling with mischief, flirty and fun demeanor, provocative charm. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 7. Cheeky
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_07_cheeky.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. CHEEKY expression with impish grin, slightly tilted head, eyes full of playful intent, cute and sassy vibe, endearing mischief. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 8. Mischievous
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/playful_08_mischievous.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. MISCHIEVOUS expression with sly smile, narrowed eyes plotting something fun, devious yet charming look, up to no good. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

---

## GLAMOUR BOARD TEMPLATES (8 Expressions)

### 1. Sultry Gaze
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_01_sultry_gaze.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SULTRY GAZE expression with half-lidded eyes, intense smoldering look, slightly parted lips, confident and alluring demeanor, magnetic presence. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 2. Raised Eyebrow
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_02_raised_eyebrow.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. RAISED EYEBROW expression with one eyebrow arched questioningly, slight smirk, skeptical yet intrigued look, sophisticated demeanor, cool confidence. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 3. Mysterious Smile
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_03_mysterious_smile.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. MYSTERIOUS SMILE expression with enigmatic Mona Lisa-like smile, knowing eyes, subtle and intriguing expression, elegant demeanor, secrets behind the eyes. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 4. Side Glance
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_04_side_glance.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SIDE GLANCE expression with eyes looking to the side while face forward, coy and flirty look, subtle smile, captivating demeanor, intriguing sideways gaze. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 5. Pouting
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_05_pouting.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. POUTING expression with lips pushed forward in a pout, slightly furrowed brow, cute and attention-seeking look, playfully demanding. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 6. Alluring
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_06_alluring.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. ALLURING expression with captivating gaze, slightly tilted head, inviting smile, magnetic and attractive demeanor, drawing you in. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 7. Intense
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_07_intense.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. INTENSE expression with piercing focused gaze, serious demeanor, strong eye contact, powerful and commanding presence, unwavering attention. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 8. Dreamy
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/glamour_08_dreamy.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. DREAMY expression with soft unfocused gaze, gentle smile, lost in thought, ethereal and romantic mood, wistful and faraway look. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

---

## CASUAL BOARD TEMPLATES (8 Expressions)

### 1. Laughing
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_01_laughing.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. LAUGHING expression with head thrown back slightly, mouth wide open in genuine laughter, eyes crinkled shut with joy, infectious happiness, pure delight. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 2. Thinking
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_02_thinking.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. THINKING expression with eyes looking up or to the side, slight furrow of concentration, finger possibly touching chin, contemplative mood, deep in thought. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 3. Curious
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_03_curious.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. CURIOUS expression with slightly tilted head, raised eyebrows, wide interested eyes, inquisitive and engaged look, wanting to know more. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 4. Excited
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_04_excited.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. EXCITED expression with bright wide eyes, big enthusiastic smile, animated and energetic demeanor, pure joy and anticipation, barely containing enthusiasm. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 5. Bored
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_05_bored.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. BORED expression with half-lidded eyes, slight frown, disinterested look, possibly resting chin on hand, unenthusiastic demeanor, waiting for something interesting. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 6. Sleepy
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_06_sleepy.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. SLEEPY expression with heavy drooping eyelids, yawning or about to yawn, tired and drowsy look, relaxed facial muscles, ready for bed. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 7. Confused
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_07_confused.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. CONFUSED expression with furrowed brow, squinted eyes, tilted head, puzzled and bewildered look, trying to understand, perplexed. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 8. Hopeful
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/casual_08_hopeful.png",
  "prompt": "Portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. HOPEFUL expression with bright eyes looking upward, gentle optimistic smile, expectant and positive demeanor, dreaming of good things, anticipating the best. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

---

## 3D SKULL MODEL TEMPLATES (8 Angles)

### 1. Front Neutral
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_01_front_neutral.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. FRONT VIEW facing camera directly, NEUTRAL expression with relaxed face, lips gently closed, symmetrical pose. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 2. Front Smile
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_02_front_smile.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. FRONT VIEW facing camera directly, SMILING expression with genuine bright smile showing teeth, eyes crinkled with joy. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{REFERENCE_PATH}}"]
}
```

### 3. Three-Quarter Left
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_03_3q_left.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. THREE-QUARTER LEFT VIEW with head turned 45 degrees to the left, neutral expression, showing left side of face more prominently, revealing cheekbone and jaw structure. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

### 4. Three-Quarter Right
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_04_3q_right.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. THREE-QUARTER RIGHT VIEW with head turned 45 degrees to the right, neutral expression, showing right side of face more prominently, revealing cheekbone and jaw structure. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

### 5. Profile Left
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_05_profile_left.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. FULL LEFT PROFILE VIEW with head turned 90 degrees to the left, showing complete side profile of face, nose bridge, jawline visible, ear partially visible. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

### 6. Profile Right
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_06_profile_right.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. FULL RIGHT PROFILE VIEW with head turned 90 degrees to the right, showing complete side profile of face, nose bridge, jawline visible, ear partially visible. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

### 7. Looking Up
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_07_looking_up.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. LOOKING UP pose with face tilted upward, chin raised, eyes looking up toward the sky, showing underside of chin and jaw, neck visible. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

### 8. Looking Down
```json
{
  "aspect_ratio": "portrait",
  "path": "{{OUTPUT_PATH}}/angle_08_looking_down.png",
  "prompt": "Close-up portrait photograph of a {{AGE_DESC}} {{GENDER}} with {{HAIR_COLOR}} {{HAIR_STYLE}}, {{EYE_COLOR}} eyes, {{DISTINGUISHING}}, {{SKIN_TONE}}, {{FACE_SHAPE}}. LOOKING DOWN pose with face tilted downward, chin lowered, eyes looking down, showing top of head and forehead more prominently, contemplative angle. {{STYLE}}, {{BACKGROUND}}, {{LIGHTING}}, casual unposed look, high quality authentic feel, 3D skull model reference style.",
  "references": ["{{FRONT_NEUTRAL_PATH}}"]
}
```

---

## USAGE EXAMPLE

Here's an example of how to fill in the templates for a new character:

**Character: "Marcus Chen"**

```
{{HAIR_COLOR}}        = "jet black"
{{HAIR_STYLE}}        = "short textured hair with fade on sides"
{{EYE_COLOR}}         = "dark brown"
{{SKIN_TONE}}         = "warm golden tan complexion with smooth texture"
{{FACE_SHAPE}}        = "square face with strong angular jawline"
{{DISTINGUISHING}}    = "thick dark eyebrows, straight nose, full lips"
{{GENDER}}            = "man"
{{AGE_DESC}}          = "young"
{{STYLE}}             = "Natural iPhone photo aesthetic"
{{BACKGROUND}}        = "indoor background"
{{LIGHTING}}          = "natural lighting"
{{REFERENCE_PATH}}    = "/path/to/marcus_reference.png"
{{OUTPUT_PATH}}       = "/path/to/output/marcus"
```

**Resulting Happy Expression Prompt:**
```json
{
  "aspect_ratio": "portrait",
  "path": "/path/to/output/marcus/emotion_01_happy.png",
  "prompt": "Portrait photograph of a young man with jet black short textured hair with fade on sides, dark brown eyes, thick dark eyebrows, straight nose, full lips, warm golden tan complexion with smooth texture, square face with strong angular jawline. HAPPY expression with bright genuine smile, eyes crinkled with joy, teeth showing, radiating warmth and happiness. Natural iPhone photo aesthetic, indoor background, natural lighting, casual unposed look, high quality authentic feel.",
  "references": ["/path/to/marcus_reference.png"]
}
```

---

## QUICK REFERENCE: ALL 40 EXPRESSIONS

| Board | Expressions |
|-------|-------------|
| **Emotion** | Happy, Sad, Angry, Surprised, Fearful, Disgusted, Neutral, Contempt |
| **Playful** | Winking, Smirking, Tongue Out, Blowing Kiss, Giggling, Teasing, Cheeky, Mischievous |
| **Glamour** | Sultry Gaze, Raised Eyebrow, Mysterious Smile, Side Glance, Pouting, Alluring, Intense, Dreamy |
| **Casual** | Laughing, Thinking, Curious, Excited, Bored, Sleepy, Confused, Hopeful |
| **3D Angles** | Front Neutral, Front Smile, 3/4 Left, 3/4 Right, Profile Left, Profile Right, Looking Up, Looking Down |

---

## NOTES FOR BEST RESULTS

1. **Reference Image Quality**: Use a clear, well-lit reference image with the face clearly visible
2. **Consistency**: For 3D Skull Model board, generate Front Neutral first, then use it as reference for all other angles
3. **Style Matching**: Adjust the {{STYLE}} variable to match your desired aesthetic (iPhone, studio, cinematic, etc.)
4. **Batch Processing**: Generate in batches of 2-4 images at a time for efficiency
5. **Aspect Ratio**: Portrait works best for face-focused boards; use landscape for full-body shots
