export interface CompanyProfile {
  website: string;
  name?: string;
  phones?: string[];
  social?: {
    facebook?: string[];
    linkedin?: string[];
    twitter?: string[];
    instagram?: string[];
    youtube?: string[];
    other?: string[];
  };
  address?: string;
}

export interface ScrapeStats {
  totalWebsites: number;
  crawled: number;
  phonesFound: number;
  socialsFound: number;
  addressesFound: number;
}
