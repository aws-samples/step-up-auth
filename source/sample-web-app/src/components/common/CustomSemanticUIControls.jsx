// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import {
  Form,
  Checkbox as SemanticUICheckbox,
  Dropdown,
  Label,
  Input,
  Radio,
  Select
} from 'semantic-ui-react';
import PropTypes from 'prop-types';

// custom Checkbox field
export const Checkbox = ({
  input,
  checked,
  label,
  defaultChecked,
  width,
  ...rest
}) => (
  <Form.Field
    control={SemanticUICheckbox}
    label={label}
    checked={checked}
    defaultChecked={defaultChecked}
    onClick={(event, data) => input.onChange(data.checked)}
    width={width}
    {...rest} />
);
Checkbox.propTypes = {
  input: PropTypes.any,
  checked: PropTypes.bool,
  label: PropTypes.string,
  defaultChecked: PropTypes.bool,
  width: PropTypes.number
};

// custom Input field with Label component
export const LabelInputField = ({
  input,
  label,
  required,
  width,
  inline,
  meta: { touched, error },
  ...rest
}) => (
  <Form.Field error={!!(touched && error)} required={required} width={width} inline={inline}>
    {label && <label>{label}</label>}
    <Input required={required} {...input} {...rest} />
    {touched && error ? (
      <Label color="red" pointing>
        {error}
      </Label>
    ) : null}
  </Form.Field>
);
LabelInputField.propTypes = {
  input: PropTypes.any,
  label: PropTypes.string,
  required: PropTypes.bool,
  width: PropTypes.number,
  inline: PropTypes.bool,
  meta: PropTypes.object
};

// custom Input field without Label component
export const InputField = ({
  input,
  required,
  width,
  meta: { touched, error },
  ...rest
}) => (
  <Form.Field error={!!(touched && error)} required={required} width={width}>
    <Input required={required} {...input} {...rest} />
    {touched && error ? (
      <Label color="red" pointing>
        {error}
      </Label>
    ) : null}
  </Form.Field>
);
InputField.propTypes = {
  input: PropTypes.any,
  required: PropTypes.bool,
  width: PropTypes.number,
  meta: PropTypes.object
};


// custom Checkbox field
export const ToggleField = ({
  input,
  label,
  defaultChecked,
  width,
  ...rest
}) => (
  <Form.Field
    control={Radio}
    toggle
    label={label}
    checked={!!input.value}
    defaultChecked={defaultChecked}
    onClick={(event, data) => input.onChange(data.checked)}
    width={width}
    {...rest} />
);
ToggleField.propTypes = {
  input: PropTypes.any,
  label: PropTypes.string,
  defaultChecked: PropTypes.bool,
  width: PropTypes.number
};


// custom Toggle component
/* eslint-disable react/prop-types */
export const Toggle = ({
  input,
  label,
  defaultChecked
}) => (
  <Radio
    toggle
    label={label}
    checked={!!input.value}
    defaultChecked={defaultChecked}
    onClick={(event, data) => input.onChange(data.checked)} />
);
/* eslint-enable react/prop-types */

// custom Single-Select with Search Dropdown component
export const SelectField = ({
  input,
  label,
  required,
  width,
  inline,
  options,
  meta: { touched, error },
  ...custom
}) => (
  <Form.Field error={!!(touched && error)} required={required} width={width} inline={inline}>
    {label && <label>{label}</label>}
    <Select
      search
      value={input.value}
      required={required}
      options={options}
      onChange={(event, data) => input.onChange(data.value)}
      {...custom} />
    {touched && error ? (
      <Label color="red" pointing>
        {error}
      </Label>
    ) : null}
  </Form.Field>
);
SelectField.propTypes = {
  input: PropTypes.any,
  label: PropTypes.string,
  required: PropTypes.bool,
  width: PropTypes.number,
  inline: PropTypes.bool,
  options: PropTypes.any,
  meta: PropTypes.object
};


// custom Multiple-Select with Search Dropdown component
export const MultiSelectSearchDropdownField = ({
  input,
  label,
  required,
  width,
  inline,
  options,
  meta: { touched, error },
  ...custom
}) => (
  <Form.Field error={!!(touched && error)} required={required} width={width} inline={inline}>
    {label && <label>{label}</label>}
    <Dropdown
      search
      fluid
      selection
      multiple
      value={input.value}
      required={required}
      options={options}
      onChange={(event, data) => input.onChange(data.value)}
      {...custom} />
    {touched && error ? (
      <Label color="red" pointing>
        {error}
      </Label>
    ) : null}
  </Form.Field>
);
MultiSelectSearchDropdownField.propTypes = {
  input: PropTypes.any,
  label: PropTypes.string,
  required: PropTypes.bool,
  width: PropTypes.number,
  inline: PropTypes.bool,
  options: PropTypes.any,
  meta: PropTypes.object
};


// custom Multiple-Select with Search and AllowAddition Dropdown component
export const MultiSelectSearchWithAdditionsDropdownField = ({
  input,
  label,
  required,
  width,
  inline,
  options,
  meta: { touched, error },
  ...custom
}) => (
  <Form.Field error={!!(touched && error)} required={required} width={width} inline={inline}>
    {label && <label>{label}</label>}
    <Dropdown
      search
      fluid
      selection
      multiple
      allowAdditions
      value={input.value}
      required={required}
      options={options}
      onChange={(event, data) => input.onChange(data.value)}
      onAddItem={(event, data) => input.onAddItem(data.value)}
      {...custom} />
    {touched && error ? (
      <Label color="red" pointing>
        {error}
      </Label>
    ) : null}
  </Form.Field>
);
MultiSelectSearchWithAdditionsDropdownField.propTypes = {
  input: PropTypes.any,
  label: PropTypes.string,
  required: PropTypes.bool,
  width: PropTypes.number,
  inline: PropTypes.bool,
  options: PropTypes.any,
  meta: PropTypes.object
};

