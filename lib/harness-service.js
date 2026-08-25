'use strict';

class HarnessService {
  constructor(options) {
    this.backend = options.backend;
    this.cliBin = options.cliBin;
    this.port = options.port;
    this.nodeBin = options.nodeBin;
    this.cwd = options.cwd;
    this.env = options.env;
    this.log = options.log || (() => {});
    this.process = null;
    this.starting = null;
    // 桌面层自己拉起的后端的启动时刻（复用已运行实例时为 null，表示未知）。
    this.startedAt = null;
  }

  get owned() {
    return Boolean(this.process);
  }

  start() {
    if (this.starting) return this.starting;
    const operation = this.startOnce();
    const tracked = operation.finally(() => {
      if (this.starting === tracked) this.starting = null;
    });
    this.starting = tracked;
    return tracked;
  }

  async startOnce() {
    const status = await this.backend.probe(this.port);
    if (status.harness) {
      this.log(`复用已运行的 Harness：http://127.0.0.1:${this.port}`);
      return true;
    }
    if (status.reachable) {
      throw new Error(`端口 ${this.port} 已被其他应用占用，请关闭占用程序或更换端口。`);
    }
    if (!this.cliBin) throw new Error('未找到可运行的 Harness CLI。');
    if (this.process) {
      const stale = this.process;
      this.process = null;
      this.log('Harness 进程无响应，正在重新启动。');
      await this.backend.stop(stale);
    }

    this.log(`正在启动 Harness：http://127.0.0.1:${this.port}`);
    const child = this.backend.start({
      cliBin: this.cliBin,
      port: this.port,
      nodeBin: this.nodeBin,
      cwd: this.cwd,
      env: this.env,
    });
    this.process = child;
    child.stdout?.on('data', (data) => this.log(`[Harness] ${String(data).trimEnd()}`));
    child.stderr?.on('data', (data) => this.log(`[Harness] ${String(data).trimEnd()}`));

    const exited = new Promise((resolve) => {
      child.once('error', (error) => {
        this.log(`Harness 启动失败：${error.message}`);
        if (this.process === child) this.process = null;
        resolve(false);
      });
      child.once('close', (code) => {
        this.log(`Harness 已退出（代码 ${code}）。`);
        if (this.process === child) this.process = null;
        resolve(false);
      });
    });
    const ready = await Promise.race([
      this.backend.waitForHarness(this.port, 45000),
      exited,
    ]);
    if (ready) {
      this.startedAt = Date.now();
      this.log('Harness 已就绪。');
      return true;
    }

    if (this.process === child) {
      this.process = null;
      await this.backend.stop(child);
    }
    this.log('Harness 启动超时或提前退出。');
    return false;
  }

  async stop() {
    if (this.starting) await this.starting.catch(() => {});
    const child = this.process;
    if (!child) return;
    this.process = null;
    this.startedAt = null;
    await this.backend.stop(child);
    this.log('Harness 已停止。');
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  stopImmediately() {
    const child = this.process;
    this.process = null;
    if (!child) return;
    try { child.kill('SIGTERM'); } catch { /* process already stopped */ }
  }
}

module.exports = { HarnessService };
