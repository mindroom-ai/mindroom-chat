export const ADD_ACCOUNT_SEARCH_PARAM = 'addAccount';
export const ADD_ACCOUNT_SEARCH_VALUE = '1';

export const isAddAccountSearch = (search: string | URLSearchParams): boolean => {
  const searchParams =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;

  return searchParams.get(ADD_ACCOUNT_SEARCH_PARAM) === ADD_ACCOUNT_SEARCH_VALUE;
};

export const withAddAccountSearch = (path: string): string => {
  const [pathWithSearch, hash = ''] = path.split('#', 2);
  const [pathname, search = ''] = pathWithSearch.split('?', 2);
  const searchParams = new URLSearchParams(search);

  searchParams.set(ADD_ACCOUNT_SEARCH_PARAM, ADD_ACCOUNT_SEARCH_VALUE);

  const nextSearch = searchParams.toString();
  const nextHash = hash ? `#${hash}` : '';
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`;
};
