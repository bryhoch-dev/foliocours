declare module 'mammoth/mammoth.browser' {
  export interface MammothMessage {
    type: 'warning' | 'error';
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    arrayBuffer: ArrayBuffer;
  }

  const mammoth: {
    convertToHtml: (input: MammothInput) => Promise<MammothResult>;
    extractRawText: (input: MammothInput) => Promise<MammothResult>;
  };

  export default mammoth;
}
