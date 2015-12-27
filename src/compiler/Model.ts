import {Spec} from '../schema/schema';
import {FieldDef} from '../schema/fielddef.schema';

import {COLUMN, ROW, X, Y, COLOR, DETAIL, Channel, supportMark} from '../channel';
import {SOURCE, SUMMARY} from '../data';
import * as vlFieldDef from '../fielddef';
import * as vlEncoding from '../encoding';
import {compileLayout} from './layout';
import {AREA, BAR, POINT, TICK, CIRCLE, SQUARE, Mark} from '../mark';
import * as schema from '../schema/schema';
import * as schemaUtil from '../schema/schemautil';
import {StackProperties} from './stack';
import {type as scaleType} from './scale';
import {getFullName, NOMINAL, ORDINAL, TEMPORAL} from '../type';
import {contains, duplicate} from '../util';
import {Encoding} from '../schema/encoding.schema';


interface FieldRefOption {
  /** exclude bin, aggregate, timeUnit */
  nofn?: boolean;
  /** exclude aggregation function */
  noAggregate?: boolean;
  /** include 'datum.' */
  datum?: boolean;
  /** replace fn with custom function prefix */
  fn?: string;
  /** prepend fn with custom function prefix */
  prefn?: string;
  /** append suffix to the field ref for bin (default='_start') */
  binSuffix?: string;
}


/**
 * Internal model of Vega-Lite specification for the compiler.
 */

export class Model {
  private _spec: Spec;
  private _stack: StackProperties;
  private _layout: any;

  constructor(spec: Spec, theme?) {
    var defaults = schema.instantiate();
    this._spec = schemaUtil.merge(defaults, theme || {}, spec);


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
    }, this);

    // calculate stack
    this._stack = this.getStackProperties();
    this._layout = compileLayout(this);
  }

  private getStackProperties(): StackProperties {
    var stackChannels = (this.has(COLOR) ? [COLOR] : [])
      .concat(this.has(DETAIL) ? [DETAIL] : []);

    if (stackChannels.length > 0 &&
      (this.is(BAR) || this.is(AREA)) &&
      this.config('stack') !== false &&
      this.isAggregate()) {
      var isXMeasure = this.isMeasure(X);
      var isYMeasure = this.isMeasure(Y);

      if (isXMeasure && !isYMeasure) {
        return {
          groupbyChannel: Y,
          fieldChannel: X,
          stackChannels: stackChannels,
          config: this.config('stack')
        };
      } else if (isYMeasure && !isXMeasure) {
        return {
          groupbyChannel: X,
          fieldChannel: Y,
          stackChannels: stackChannels,
          config: this.config('stack')
        };
      }
    }
    return null;
  }

  public layout(): any {
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
    // equivalent to calling vlenc.has(this._spec.encoding, channel)
    return this._spec.encoding[channel].field !== undefined;
  }

  public fieldDef(channel: Channel): FieldDef {
    return this._spec.encoding[channel];
  }

  // get "field" reference for vega
  public field(channel: Channel, opt?: FieldRefOption) {
    opt = opt || {};

    const fieldDef = this.fieldDef(channel);

    var f = (opt.datum ? 'datum.' : '') + (opt.prefn || ''),
      field = fieldDef.field;

    if (vlFieldDef.isCount(fieldDef)) {
      return f + 'count';
    } else if (opt.fn) {
      return f + opt.fn + '_' + field;
    } else if (!opt.nofn && fieldDef.bin) {
      var binSuffix = opt.binSuffix ||
        (scaleType(channel, this) === 'ordinal' ? '_range' : '_start');
      return f + 'bin_' + field + binSuffix;
    } else if (!opt.nofn && !opt.noAggregate && fieldDef.aggregate) {
      return f + fieldDef.aggregate + '_' + field;
    } else if (!opt.nofn && fieldDef.timeUnit) {
      return f + fieldDef.timeUnit + '_' + field;
    } else {
      return f + field;
    }
  }

  public fieldTitle(channel: Channel): string {
    return vlFieldDef.title(this._spec.encoding[channel]);
  }

  public numberFormat(channel?: Channel): string {
    // TODO(#497): have different number format based on numberType (discrete/continuous)
    return this.config('numberFormat');
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
      ( fieldDef.type === TEMPORAL && scaleType(channel, this) === 'ordinal' )
      );
  }

  public isDimension(channel: Channel) {
    return this.has(channel) &&
      vlFieldDef.isDimension(this.fieldDef(channel));
  }

  public isMeasure(channel: Channel) {
    return this.has(channel) &&
      vlFieldDef.isMeasure(this.fieldDef(channel));
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
   * @return Config value from the spec, or a default value if unspecified.
   */
  public config(name: string) {
    return this._spec.config[name];
  }

  /**
   * @return Label config value from the spec, or a default value if unspecified.
   */
  public labelConfig(name: string) {
    return this._spec.config.label[name];
  }

  /**
   * @return Marks config value from the spec, or a default value if unspecified.
   */
  public marksConfig(name: string) {
    const value = this._spec.config.marks[name];
    switch (name) {
      case 'filled':
        if (value === undefined) {
          // only point is not filled by default
          return this.mark() !== POINT;
        }
        return value;
      case 'opacity':
        if (value === undefined && contains([POINT, TICK, CIRCLE, SQUARE], this.mark())) {
          // point-based marks and bar
          if (!this.isAggregate() || this.has(DETAIL)) {
            return 0.7;
          }
        }
        return value;
      case 'orient':
        const stack = this.stack();
        if (stack) {
          // For stacked chart, explicitly specified orient property will be ignored.
          return stack.groupbyChannel === Y ? 'horizontal' : undefined;
        }
        if (value === undefined) {
          return this.isMeasure(X) && !this.isMeasure(Y) ?
            // horizontal if X is measure and Y is dimension or unspecified
            'horizontal' :
            // vertical (undefined) otherwise.  This includes when
            // - Y is measure and X is dimension or unspecified
            // - both X and Y are measures or both are dimension
            undefined;  //
        }
        return value;
    }
    return value;
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
    const abbreviated = contains([ROW, COLUMN, X, Y], channel) ?
      fieldDef.axis.shortTimeLabels :
      typeof legend !== 'boolean' ? legend.shortTimeLabels : false;

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
