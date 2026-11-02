import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaults = () => ({
  hostId: `urn:uuid:${randomUUID()}`, photos: [], designs: [], events: [], seen: [],
  album: { title: 'The good old days', subtitle: 'Little moments. A whole lot of meaning.', theme: 'sage', mode: 'scrapbook' },
  settings: { captureCountdown:false, captureAnimation:true, template: 'polaroid', bitsEnabled: false, subsEnabled: false, minBits: 100, showAttribution: false }
});

export class Store {
  constructor(directory) { this.directory = directory; this.tail = Promise.resolve(); }
  async init() {
    await mkdir(path.join(this.directory, 'images'), { recursive: true });
    try { this.data = JSON.parse(await readFile(path.join(this.directory, 'library.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.data = defaults(); await this.save(); }
    if (!this.data.albums?.length) {
      const album = { ...this.data.album, id: randomUUID(), createdAt: new Date().toISOString() };
      this.data.albums = [album]; this.data.album = album;
      this.data.settings.activeAlbumId = album.id;
      for (const photo of this.data.photos) photo.albumId = album.id;
      await this.save();
    }
    this.data.album = this.data.albums[0];
    const samples={
      '/assets/scene-0.svg':'/assets/stream-reaction.png',
      '/assets/scene-1.svg':'/assets/stream-adventure.png',
      '/assets/scene-2.svg':'/assets/stream-competitive.png'
    };
    let updatedSamples=false;
    for(const photo of this.data.photos){
      if(photo.demo&&samples[photo.image]){photo.image=samples[photo.image];updatedSamples=true;}
    }
    if(updatedSamples)await this.save();
    return this;
  }
  async save() {
    const contents = JSON.stringify(this.data, null, 2);
    const operation = this.tail.then(async () => {
      const temporary = path.join(this.directory, 'library.json.tmp');
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, path.join(this.directory, 'library.json'));
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async record(event) {
    this.data.events.unshift({ id: randomUUID(), at: new Date().toISOString(), ...event });
    this.data.events = this.data.events.slice(0, 100);
    await this.save();
  }
}
