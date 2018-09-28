export interface ActualExpected {
  readonly actual: string;
  readonly expected: string;
}

export interface Message {
  readonly status: string;
  readonly message?: string|ActualExpected;
}

export interface Context {
  readonly url: string;
  readonly $: CheerioStatic;
  readonly headers: {
    [key: string]: string;
  };
}

export interface Test {
  (context: Context): Promise<Message>;
}

export interface TestList {
  (context: Context): Promise<Message[]>;
}