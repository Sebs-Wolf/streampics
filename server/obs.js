import OBSWebSocket from 'obs-websocket-js';

export class ObsConnection {
  constructor(onChange = () => {}) {
    this.client = new OBSWebSocket(); this.connected = false; this.scene = ''; this.onChange = onChange;
    this.client.on('ConnectionClosed', () => { this.connected = false; this.onChange(); });
    this.client.on('CurrentProgramSceneChanged', ({ sceneName }) => { this.scene = sceneName; this.onChange(); });
    this.client.on('error', () => {});
  }
  async connect(url, password) {
    const target = new URL(url);
    if (target.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Use a local OBS WebSocket URL, such as ws://127.0.0.1:4455.');
    await this.client.disconnect();
    await this.client.connect(url, password, { rpcVersion: 1 });
    this.connected = true;
    this.scene = (await this.client.call('GetCurrentProgramScene')).currentProgramSceneName;
    this.onChange();
  }
  async capture() {
    if (!this.connected) throw new Error('Connect OBS before capturing a live moment.');
    const { currentProgramSceneName } = await this.client.call('GetCurrentProgramScene');
    const { imageData } = await this.client.call('GetSourceScreenshot', {
      sourceName: currentProgramSceneName, imageFormat: 'png', imageWidth: 1600, imageCompressionQuality: -1
    });
    return { buffer: Buffer.from(imageData.split(',')[1], 'base64'), scene: currentProgramSceneName };
  }
}
