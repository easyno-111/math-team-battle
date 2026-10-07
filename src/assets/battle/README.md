# 전투 에셋 안내

현재 이 폴더에는 GPT로 만든 박 4단계·현수막·장대·바닥 PNG가 들어 있습니다. 원본은 1254px 수준이라 투명 여백을 잘라내고 256px 안팎으로 줄여 넣었습니다. 바꾸고 싶으면 같은 이름으로 덮어쓰면 됩니다.

이 폴더에 PNG를 넣으면 전투 화면이 자동으로 사용합니다. 파일이 없으면 코드가 그린 픽셀 박을 씁니다.
파일 이름이 정확해야 하고, 모두 **투명 배경 PNG**, **정면**, **글자 없음**, **회색조(또는 흰색 계열)** 로 만들어 주세요.
팀 색은 코드가 입히므로 색을 칠하지 않는 것이 중요합니다.

| 파일 | 내용 | 권장 크기 |
| --- | --- | --- |
| `gourd-1.png` | 온전한 박. 운동회 박 터뜨리기의 둥근 박, 위에 짧은 꼭지 | 256×256 |
| `gourd-2.png` | 같은 박에 금이 한두 줄 | 256×256 |
| `gourd-3.png` | 금이 여러 줄, 조각이 살짝 벌어짐 | 256×256 |
| `gourd-4.png` | 거의 터지기 직전, 틈 사이로 빛 | 256×256 |
| `banner.png` | 박에서 아래로 펼쳐지는 두루마리 현수막. 글자 없이 빈 천 | 256×192 |
| `pole.png` | 박을 매단 장대(세로로 긴 이미지) | 32×512 |
| `ground.png` | 운동장 바닥 띠(가로로 긴 이미지, 좌우 반복 가능) | 960×64 |

## GPT 이미지 생성용 프롬프트

아래 문장을 그대로 붙여 넣고, 표의 내용에 맞게 괄호 안만 바꿔 쓰면 됩니다.

```
Pixel art sprite for a 2D game, single object centered, transparent background, no text, no shadow on the ground.
Style: chunky 16-bit pixel art, 1px dark outline, flat shading with 3 tones, grayscale only (white, light gray, mid gray, dark gray).
Object: (a round Korean sports-day paper gourd "bak" with a short stem on top, intact, no cracks).
Square canvas 256x256, the object fills about 80% of the canvas, front view, orthographic.
```

- `gourd-2`~`gourd-4`: Object 부분을 `the same gourd with (two thin cracks / many cracks and slightly separated pieces / about to burst, pieces separated with a glowing gap)` 로 바꿔 네 장을 같은 스타일로 받으세요. 한 대화에서 연속으로 요청하면 모양이 비슷하게 유지됩니다.
- `banner`: Object 를 `a blank cloth scroll banner unrolled vertically, hanging from a wooden rod at the top, rolled edge at the bottom, empty surface` 로 바꾸고 캔버스를 `256x192` 로 지정하세요.
- `pole`: Object 를 `a tall wooden pole with a small crossbar at the top, vertical` 로, 캔버스를 `32x512` 로 지정하세요.
- `ground`: Object 대신 `a horizontal strip of a school sports field: packed sandy ground with a white chalk line, seamless left-to-right` 로, 캔버스를 `960x64` 로 지정하세요. 이 파일은 색이 있어도 됩니다.

받은 이미지는 배경이 정말 투명한지 확인하세요. 흰 배경이 깔려 있으면 박 주위에 흰 사각형이 보입니다.
도트 사람, 검기·화살·마법탄, 파티클은 코드가 직접 그리므로 따로 만들지 않아도 됩니다.
