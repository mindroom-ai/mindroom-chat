import React from 'react';
import type { SearchResultBodyRenderer } from './SearchResultGroup';
import { MindroomSearchResultBody } from './SearchResultBody';

export const renderMindroomSearchResultBody: SearchResultBodyRenderer = (props) => (
  <MindroomSearchResultBody {...props} />
);
