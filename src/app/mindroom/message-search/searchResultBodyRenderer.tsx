import React from 'react';
import type { SearchResultBodyRenderer } from '../../features/message-search/SearchResultGroup';
import { MindroomSearchResultBody } from './MindroomSearchResultBody';

export const renderMindroomSearchResultBody: SearchResultBodyRenderer = (props) => (
  <MindroomSearchResultBody {...props} />
);
