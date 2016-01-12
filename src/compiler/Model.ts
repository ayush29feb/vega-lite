import {Spec} from '../schema/schema';
import {Axis, axis as axisSchema} from '../schema/axis.schema';
import {Encoding} from '../schema/encoding.schema';
import {FieldDef} from '../schema/fielddef.schema';
import {instantiate} from '../schema/schemautil';
import * as schema from '../schema/schema';
import * as schemaUtil from '../schema/schemautil';

import {COLUMN, ROW, X, Y, Channel, supportMark} from '../channel';
import {SOURCE, SUMMARY} from '../data';
import * as vlFieldDef from '../fielddef';
import {FieldRefOption} from '../fielddef';
import * as vlEncoding from '../encoding';
import {Mark} from '../mark';

import {getFullName, NOMINAL, ORDINAL, TEMPORAL} from '../type';
import {contains, duplicate, extend} from '../util';

import {compileMarkConfig} from './config';
import {compileLayout, Layout} from './layout';
import {compileStackProperties, StackProperties} from './stack';
import {type as scaleType} from './scale';

/**
 * Internal model of Vega-Lite specification for the compiler.
 */

export class Model {
  private _spec: Spec;
  private _stack: StackProperties;
  private _layout: Layout;

  constructor(spec: Spec, theme?) {
    var defaults = schema.instantiate();
    this._spec = schemaUtil.mergeDeep(defaults, theme || {}, spec);


    vlEncoding.forEach(this._spec.encoding, function(fieldDef: FieldDef, channel: Channel) {
      if (!supportMark(channel, this._spec.mark)) {
        // Drop unsupported channel

        // FIXME consolidate warning method
        console.warn(channel, 'dropped as it is incompatible with', this._spec.mark);
        delete this._spec.encoding[channel].field;
      }

      if (fieldDef.type) {
        // convert short type to full type
        fieldDef.type = getFullName(fieldDef.type);
      }

      if (fieldDef.axis === true) {
        fieldDef.axis = instantiate(axisSchema);
      }
    }, this);

    // calculate stack
    this._stack = compileStackProperties(this._spec);
    this._spec.config.mark = compileMarkConfig(this._spec, this._stack);
    this._layout = compileLayout(this);

  }

  public layout(): Layout {
    return this._layout;
  }

  public stack(): StackProperties {
    return this._stack;
  }

  public toSpec(excludeConfig?, excludeData?) {
    var encoding = duplicate(this._spec.encoding),
      spec: any;

    spec = {
      mark: this._spec.mark,
      encoding: encoding
    };

    if (!excludeConfig) {
      spec.config = duplicate(this._spec.config);
    }

    if (!excludeData) {
      spec.data = duplicate(this._spec.data);
    }

    // remove defaults
    var defaults = schema.instantiate();
    return schemaUtil.subtract(spec, defaults);
  }

  public mark(): Mark {
    return this._spec.mark;
  }

  public spec(): Spec {
    return this._spec;
  }

  public is(mark: Mark) {
    return this._spec.mark === mark;
  }

  public has(channel: Channel) {
    return vlEncoding.has(this._spec.encoding, channel);
  }

  public fieldDef(channel: Channel): FieldDef {
    return this._spec.encoding[channel];
  }

  /** Get "field" reference for vega */
  public field(channel: Channel, opt: FieldRefOption = {}) {
    const fieldDef = this.fieldDef(channel);
    if (fieldDef.bin) { // bin has default suffix that depends on scaleType
      opt = extend({
        binSuffix: scaleType(fieldDef, channel, this.mark()) === 'ordinal' ? '_range' : '_start'
      }, opt);
    }
    return vlFieldDef.field(fieldDef, opt);
  }

  public fieldTitle(channel: Channel): string {
    return vlFieldDef.title(this._spec.encoding[channel]);
  }

  public numberFormat(channel?: Channel): string {
    // TODO(#497): have different number format based on numberType (discrete/continuous)
    return this.config().numberFormat;
  };

  public channels(): Channel[] {
    return vlEncoding.channels(this._spec.encoding);
  }

  public map(f: (fd: FieldDef, c: Channel, e: Encoding) => any, t?: any) {
    return vlEncoding.map(this._spec.encoding, f, t);
  }

  public reduce(f: (acc: any, fd: FieldDef, c: Channel, e: Encoding) => any, init, t?: any) {
    return vlEncoding.reduce(this._spec.encoding, f, init, t);
  }

  public forEach(f: (fd: FieldDef, c: Channel, i:number) => void, t?: any) {
    return vlEncoding.forEach(this._spec.encoding, f, t);
  }

  public isOrdinalScale(channel: Channel) {
    const fieldDef = this.fieldDef(channel);
    return fieldDef && (
      contains([NOMINAL, ORDINAL], fieldDef.type) ||
      ( fieldDef.type === TEMPORAL && scaleType(fieldDef, channel, this.mark()) === 'ordinal' )
      );
  }

  public isDimension(channel: Channel) {
    return vlFieldDef.isDimension(this.fieldDef(channel));
  }

  public isMeasure(channel: Channel) {
    return vlFieldDef.isMeasure(this.fieldDef(channel));
  }

  public isAggregate() {
    return vlEncoding.isAggregate(this._spec.encoding);
  }

  public isFacet() {
    return this.has(ROW) || this.has(COLUMN);
  }

  public dataTable() {
    return this.isAggregate() ? SUMMARY : SOURCE;
  }

  public data() {
    return this._spec.data;
  }

  /** returns whether the encoding has values embedded */
  public hasValues() {
    var vals = this.data().values;
    return vals && vals.length;
  }

  /**
   * Get the spec configuration.
   */
  public config() {
    return this._spec.config;
  }

  public axis(channel: Channel): Axis {
    const axis = this.fieldDef(channel).axis;
    return typeof axis !== 'boolean' ? axis : {};
  }

  /** returns scale name for a given channel */
  public scale(channel: Channel): string {
    const name = this.spec().name;
    return (name ? name + '-' : '') + channel;
  }

  /** returns the template name used for axis labels for a time unit */
  public labelTemplate(channel: Channel): string {
    const fieldDef = this.fieldDef(channel);
    const legend = fieldDef.legend;
    const axis = fieldDef.axis;
    const abbreviated = contains([ROW, COLUMN, X, Y], channel) ?
      (typeof axis !== 'boolean' ? axis.shortTimeLabels : false) :
      (typeof legend !== 'boolean' ? legend.shortTimeLabels : false);

    var postfix = abbreviated ? '-abbrev' : '';
    switch (fieldDef.timeUnit) {
      case 'day':
        return 'day' + postfix;
      case 'month':
        return 'month' + postfix;
    }
    return null;
  }

}
