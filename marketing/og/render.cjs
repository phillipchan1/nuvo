/**
 * Renders public/og.jpg from the live home page: the hero type + the Schedule
 * mock, recomposed at 1200×630. Run with the marketing dev server up:
 *   npx vite --port 5174 &  node og/render.cjs
 */
const { chromium } = require('playwright')
const path = require('path')
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await p.goto('http://localhost:5174/', { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate(() => {
    const mock = document.querySelector('.mock').cloneNode(true)
    const work = getComputedStyle(document.querySelector('.hm')).getPropertyValue('--work')
    document.body.innerHTML = ''
    const stage = document.createElement('div')
    stage.className = 'hm'
    stage.style.cssText = `--work:${work};width:1200px;height:630px;overflow:hidden;position:relative;`
    stage.innerHTML = `
      <div style="position:absolute;left:64px;top:70px;z-index:2">
        <div class="hero-kick" style="margin-bottom:22px">Nuvo · Task management for the ambitious</div>
        <div class="hero-h1" style="font-size:108px;line-height:.86">
          <span class="hero-line"><span>Ambition,</span></span>
          <span class="hero-line"><span>down to</span></span>
          <span class="hero-line"><span><em>the hour.</em></span></span>
        </div>
        <p style="margin-top:34px;font-size:21px;line-height:1.45;color:var(--muted);max-width:430px">
          Initiatives, projects and every task beneath them — each with a time on your calendar.</p>
      </div>
      <div id="dev" style="position:absolute;left:590px;top:96px;width:900px;transform:perspective(1600px) rotateY(-14deg) rotateX(6deg);transform-origin:0 50%"></div>
      <div class="wordmark" style="position:absolute;left:64px;bottom:44px;font-size:28px;color:var(--text)">Nuvo</div>
      <div style="position:absolute;left:150px;bottom:51px;font-size:15px;color:var(--muted)">nuvo.day</div>`
    document.body.appendChild(stage)
    document.body.style.margin = '0'
    stage.querySelector('#dev').appendChild(mock)
    mock.querySelector('.mock-body').style.height = '520px'
  })
  await p.waitForTimeout(300)
  await p.screenshot({ path: path.join(__dirname, '../public/og.jpg'), type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630 } })
  await b.close()
})()
