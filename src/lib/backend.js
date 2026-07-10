// One storage interface, two implementations: real Google Drive, or the
// in-memory sample corpus. Everything above this file (explorer, marking,
// filing) is identical in both modes — that's the point.
import * as drive from './drive.js';
import { buildDemoCorpus } from './demoData.js';
import { buildDemoPdf } from './demoPdf.js';

export class DriveBackend {
  constructor(token, user) {
    this.token = token;
    this.userInfo = user;
    this.kind = 'drive';
  }
  user() {
    return this.userInfo;
  }
  async listChildren(folderId) {
    const files = await drive.listChildren(this.token, folderId);
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      parentId: folderId,
      properties: f.properties || {},
    }));
  }
  getPdfBytes(fileId) {
    return drive.downloadFile(this.token, fileId);
  }
  putPdfBytes(fileId, bytes) {
    return drive.updatePdfContent(this.token, fileId, bytes);
  }
  setProperties(fileId, props) {
    return drive.updateProperties(this.token, fileId, props);
  }
  rename(fileId, name) {
    return drive.renameFile(this.token, fileId, name);
  }
  move(fileId, newParentId, oldParentId) {
    return drive.moveFile(this.token, fileId, newParentId, oldParentId);
  }
  // Parent folder ids (Drive files effectively have one). Used to walk a
  // picked folder's ancestry up to Archive Scans.
  async getParents(fileId) {
    const meta = await drive.getFileMeta(this.token, fileId);
    return meta.parents || [];
  }
  createFolder(name, parentId) {
    return drive.createFolder(this.token, name, parentId);
  }
  createFile({ name, parentId, properties, bytes }) {
    return drive.uploadPdf(this.token, { bytes, filename: name, folderId: parentId, properties });
  }
  trash(fileId) {
    return drive.trashFile(this.token, fileId);
  }
}

export class DemoBackend {
  constructor() {
    this.kind = 'demo';
    const { nodes, rootIds, archiveScansId } = buildDemoCorpus();
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.rootIds = rootIds;
    // The sample corpus bakes in an Archive Scans root, so the canonical
    // filing flow (choose an archive, fetch its manifest) is exercisable
    // with zero Google setup — no localStorage/Picker involved in demo mode.
    this.archiveScansId = archiveScansId;
    this.bytesCache = new Map();
    this.nextId = 1;
  }
  user() {
    return { name: 'Hannah', email: 'hannah@example.com' };
  }
  demoRoots() {
    return this.rootIds.map((id) => ({ id, name: this.nodes.get(id).name }));
  }
  async listChildren(folderId) {
    return [...this.nodes.values()].filter((n) => n.parentId === folderId && !n.trashed);
  }
  async getPdfBytes(fileId) {
    if (this.bytesCache.has(fileId)) return this.bytesCache.get(fileId);
    const node = this.nodes.get(fileId);
    // Text files (the demo manifest.json) carry their content directly.
    const bytes = node.textContent
      ? new TextEncoder().encode(node.textContent)
      : node.demoSpec
        ? await buildDemoPdf(node.demoSpec)
        : new Uint8Array();
    this.bytesCache.set(fileId, bytes);
    return bytes;
  }
  async putPdfBytes(fileId, bytes) {
    this.bytesCache.set(fileId, bytes);
    const node = this.nodes.get(fileId);
    if (node) delete node.demoSpec; // edited — never regenerate over it
  }
  async setProperties(fileId, props) {
    const node = this.nodes.get(fileId);
    for (const [k, v] of Object.entries(props)) {
      if (v === null) delete node.properties[k];
      else node.properties[k] = v;
    }
  }
  async rename(fileId, name) {
    this.nodes.get(fileId).name = name;
  }
  async move(fileId, newParentId) {
    this.nodes.get(fileId).parentId = newParentId;
  }
  async getParents(fileId) {
    const node = this.nodes.get(fileId);
    return node?.parentId != null ? [node.parentId] : [];
  }
  async createFolder(name, parentId) {
    const id = `demo-new-${this.nextId++}`;
    this.nodes.set(id, { id, name, isFolder: true, parentId, properties: {} });
    return id;
  }
  async createFile({ name, parentId, properties, bytes }) {
    const id = `demo-new-${this.nextId++}`;
    this.nodes.set(id, { id, name, isFolder: false, parentId, properties: { ...properties } });
    this.bytesCache.set(id, bytes);
    return id;
  }
  async trash(fileId) {
    const node = this.nodes.get(fileId);
    if (node) node.trashed = true;
  }
}
