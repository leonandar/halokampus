import nodemailer from "nodemailer";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(host: string, port: number, private readonly from: string) {
    this.transport = nodemailer.createTransport({ host, port, secure: false });
  }
  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}

/** Captures mail in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];
  async send(to: string, subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
  }
}
