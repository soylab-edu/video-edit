import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { run } from "../server/core.mjs";
const dir = path.resolve("public/demo");
await fs.mkdir(dir, { recursive: true });
function ridge(seed, y, height) {
  let points = `0,900 0,${y}`;
  for (let x = 0; x <= 1600; x += 14) {
    const peak =
      Math.sin(x / 195 + seed) * 0.35 +
      Math.sin(x / 88 + seed * 4) * 0.2 +
      Math.sin(x / 33 + seed) * 0.07;
    points += ` ${x},${y - peak * height}`;
  }
  return points + " 1600,900";
}
for (let i = 0; i < 3; i++) {
  const sky = ["#c5d6d2", "#d2cdb8", "#b3cbd3"][i],
    water = ["#326973", "#50787a", "#305b6b"][i];
  const trees = Array.from({ length: 170 }, (_, j) => {
    const x = (j * 73) % 1640,
      y = 650 + ((j * 47) % 250),
      s = 10 + ((j * 13) % 44);
    return `<path d="M${x} ${y - s * 2}l${-s * 0.5} ${s}h${s * 0.22}l${-s * 0.48} ${s}h${s * 1.55}l${-s * 0.49} ${-s}h${s * 0.22}Z" fill="${j % 2 ? "#173c35" : "#23473c"}" opacity=".9"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#ebdfbd"/></linearGradient><linearGradient id="lake" x2=".6" y2="1"><stop stop-color="#77a09b"/><stop offset="1" stop-color="${water}"/></linearGradient><linearGradient id="land" x2="1" y2="1"><stop stop-color="#456251"/><stop offset="1" stop-color="#183c35"/></linearGradient><filter id="grain"><feTurbulence baseFrequency=".75" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".10"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter><radialGradient id="glow"><stop stop-color="#fff8d7" stop-opacity=".65"/><stop offset="1" stop-color="#fff8d7" stop-opacity="0"/></radialGradient></defs><g filter="url(#grain)"><path fill="url(#sky)" d="M0 0h1600v900H0z"/><ellipse cx="1160" cy="130" rx="520" ry="400" fill="url(#glow)"/><path d="M0 410L140 270 205 280 310 124 370 173 408 144 565 330 675 250 830 395 920 298 1090 390 1230 180 1330 155 1465 330 1600 250V900H0Z" fill="#8a9c93"/><path d="M310 124l-79 191 94-54 45-88 38-29 70 194-134-78Z M1230 180l-118 209 160-112 58-122 94 125-111-65Z" fill="#d4d8c8"/><polygon points="${ridge(i + 3, 455, 300)}" fill="#647f73"/><polygon points="${ridge(i + 7, 535, 220)}" fill="#456b5c"/><path d="M0 530Q440 430 720 540T1600 490V900H0Z" fill="url(#lake)"/><path d="M0 529Q330 580 650 684T1090 900H0Z" fill="url(#land)"/><path d="M1600 420Q1240 476 1190 680T1380 900H1600Z" fill="#294f40"/><path d="M0 732Q245 596 414 684T708 713Q850 700 991 900" fill="none" stroke="#1f3f36" stroke-width="63"/><path d="M0 732Q245 596 414 684T708 713Q850 700 991 900" fill="none" stroke="#a4a48d" stroke-width="33"/><path d="M0 732Q245 596 414 684T708 713Q850 700 991 900" fill="none" stroke="#cec9b0" stroke-width="2" stroke-dasharray="18 15"/>${trees}<g transform="translate(${420 + i * 62},${680 + i * 6}) rotate(12)"><rect x="-18" y="-8" width="37" height="17" rx="5" fill="#efe7d2"/><rect x="-7" y="-6" width="18" height="13" rx="2" fill="#697e7c"/><path d="M-16-7v14M15-6v12" stroke="#354e4a" stroke-width="2"/></g><path d="M1000 625h85m-180 50h60m150 29h90m-69 43h125m-250-169h50" stroke="#a7b9a9" opacity=".25" stroke-width="2"/></g></svg>`;
  await fs.writeFile(path.join(dir, `scene-${i}.svg`), svg);
  await sharp(Buffer.from(svg))
    .resize(1280, 720)
    .jpeg({ quality: 90 })
    .toFile(path.join(dir, `scene-${i}.jpg`));
  await run("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    path.join(dir, `scene-${i}.jpg`),
    "-vf",
    `zoompan=z='1+on*0.00018':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=960x540:fps=24`,
    "-t",
    String(i === 2 ? 6 : 8),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(dir, `scene-${i}.mp4`),
  ]);
}
await run("ffmpeg", [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=0.05*sin(2*PI*130.81*t)+0.025*sin(2*PI*164.81*t)+0.025*sin(2*PI*196*t):s=44100:d=22",
  "-af",
  "afade=t=in:d=2,afade=t=out:st=19:d=3,aecho=0.8:0.7:120:0.35",
  "-t",
  "22",
  "-c:a",
  "aac",
  path.join(dir, "ambient.m4a"),
]);
const names = [
  "01 · 길 위의 시작",
  "02 · 느리게 흘러가는 시간",
  "03 · 새로운 풍경",
];
await fs.writeFile(
  path.join(dir, "assets.json"),
  JSON.stringify(
    [
      ...names.map((name, i) => ({
        id: `demo-${i}`,
        name,
        type: "video",
        url: `/demo/scene-${i}.mp4`,
        thumbnail: `/demo/scene-${i}.jpg`,
        duration: i === 2 ? 6 : 8,
        hasAudio: false,
        width: 960,
        height: 540,
        demo: true,
      })),
      {
        id: "demo-music",
        name: "Slow morning · 앰비언트",
        type: "audio",
        url: "/demo/ambient.m4a",
        thumbnail: "",
        duration: 22,
        hasAudio: true,
        demo: true,
      },
    ],
    null,
    2,
  ),
);
console.log("Three illustrated demo videos and ambient audio generated.");
